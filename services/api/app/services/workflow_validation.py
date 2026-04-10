"""Structural validation for workflow graphs (Phase 1)."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.data_object_lifecycle import DATA_PUBLISHED
from app.models.data_object import DataObject
from app.models.result_object_definition import ResultObjectDefinition
from app.models.static_ingestion import StaticIngestion
from app.models.workflow import Workflow
from app.models.workflow_node import WorkflowNode
from app.services.workflow_graph_run import NODE_TYPES, topological_order


def validate_data_object_binding(
    db: Session, customer_id: uuid.UUID, data_object_id: uuid.UUID | None
) -> str | None:
    if data_object_id is None:
        return None
    row = db.get(DataObject, data_object_id)
    if not row or row.customer_id != customer_id:
        return "data_object not found"
    if row.lifecycle_status != DATA_PUBLISHED:
        return "workflow input must reference a published data_object"
    return None


def validate_static_ingestion_binding(
    db: Session,
    customer_id: uuid.UUID,
    site_id: uuid.UUID | None,
    static_ingestion_id: uuid.UUID | None,
) -> str | None:
    if static_ingestion_id is None:
        return "static node requires static_ingestion_id"
    row = db.get(StaticIngestion, static_ingestion_id)
    if not row or row.customer_id != customer_id:
        return "static ingestion not found"
    if site_id and row.site_id != site_id:
        return "static ingestion site does not match workflow site"
    now = datetime.now(timezone.utc)
    if row.end_at:
        end = row.end_at
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if end <= now:
            return "static ingestion has passed its end date"
    return None


def validate_workflow_graph(
    *,
    db: Session,
    customer_id: uuid.UUID,
    site_id: uuid.UUID | None,
    workflow_id: uuid.UUID | None,
    nodes: list[dict],
    edges: list[dict],
) -> list[str]:
    errors: list[str] = []
    if not nodes:
        errors.append("at least one node required")
        return errors

    node_ids: set[uuid.UUID] = set()
    types_by_id: dict[uuid.UUID, str] = {}
    for n in nodes:
        try:
            nid = uuid.UUID(str(n.get("id")))
        except (TypeError, ValueError):
            errors.append("invalid node id")
            continue
        node_ids.add(nid)
        nt = str(n.get("node_type") or "")
        if nt not in NODE_TYPES:
            errors.append(f"unknown node_type: {nt}")
        types_by_id[nid] = nt
        name = str(n.get("node_name") or "").strip()
        if not name:
            errors.append(f"node {nid} missing node_name")

    inputs = [nid for nid, t in types_by_id.items() if t == "input"]
    statics = [nid for nid, t in types_by_id.items() if t == "static"]
    terminates = [nid for nid, t in types_by_id.items() if t == "terminate"]
    if not inputs and not statics:
        errors.append("at least one input or static node required")
    if not terminates:
        errors.append("at least one terminate node required")

    terminate_names: list[str] = []
    for n in nodes:
        if str(n.get("node_type")) != "terminate":
            continue
        cfg = n.get("config_json") or {}
        if not isinstance(cfg, dict):
            cfg = {}
        tn = str(cfg.get("terminate_name") or "").strip()
        if not tn:
            errors.append(f"terminate node {n.get('id')} requires terminate_name")
        else:
            terminate_names.append(tn)
    if len(terminate_names) != len(set(terminate_names)):
        errors.append("terminate_name must be unique within the workflow")

    edge_pairs: list[tuple[uuid.UUID, uuid.UUID]] = []
    preds: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    succs: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for e in edges:
        try:
            a = uuid.UUID(str(e.get("source_node_id")))
            b = uuid.UUID(str(e.get("target_node_id")))
        except (TypeError, ValueError):
            errors.append("invalid edge endpoint")
            continue
        if a not in node_ids or b not in node_ids:
            errors.append("edge references unknown node")
            continue
        edge_pairs.append((a, b))
        preds[b].append(a)
        succs[a].append(b)

    for nid in node_ids:
        if types_by_id.get(nid) == "input" and preds.get(nid):
            errors.append("input node must not have incoming edges")
        if types_by_id.get(nid) == "static" and preds.get(nid):
            errors.append("static node must not have incoming edges")
        if types_by_id.get(nid) == "terminate" and succs.get(nid):
            errors.append("terminate node must not have outgoing edges")

    for nid in node_ids:
        if types_by_id.get(nid) == "join" and len(preds.get(nid, [])) < 2:
            errors.append(f"join node {nid} requires two incoming edges")

    reachable_from_sources: set[uuid.UUID] = set()
    for src in inputs + statics:
        stack = [src]
        seen = {src}
        while stack:
            cur = stack.pop()
            reachable_from_sources.add(cur)
            for v in succs.get(cur, []):
                if v not in seen:
                    seen.add(v)
                    stack.append(v)

    for nid in node_ids:
        if nid not in reachable_from_sources:
            errors.append(f"node {nid} not reachable from any input or static node")

    reaches_terminate: set[uuid.UUID] = set()
    for term in terminates:
        stack = [term]
        seen = {term}
        while stack:
            cur = stack.pop()
            reaches_terminate.add(cur)
            for p in preds.get(cur, []):
                if p not in seen:
                    seen.add(p)
                    stack.append(p)

    for nid in node_ids:
        if types_by_id.get(nid) == "terminate":
            continue
        if nid not in reaches_terminate:
            errors.append(f"node {nid} does not reach a terminate node")

    if not errors:
        try:
            topological_order(node_ids, edge_pairs)
        except Exception as e:
            errors.append(str(e))

    if site_id and terminate_names:
        for tn in set(terminate_names):
            stmt = (
                select(ResultObjectDefinition.id)
                .join(WorkflowNode, ResultObjectDefinition.terminate_node_id == WorkflowNode.id)
                .join(Workflow, ResultObjectDefinition.workflow_id == Workflow.id)
                .where(
                    Workflow.site_id == site_id,
                    Workflow.customer_id == customer_id,
                    ResultObjectDefinition.result_object_name == tn,
                    Workflow.is_published.is_(True),
                )
            )
            if workflow_id is not None:
                stmt = stmt.where(Workflow.id != workflow_id)
            if db.scalar(stmt.limit(1)):
                errors.append(
                    f"result name {tn!r} conflicts with another published workflow on this site"
                )
                break

    return errors


def full_validation_errors(db: Session, user_customer_id: uuid.UUID, wf: Workflow) -> list[str]:
    """Graph validation plus published data_object binding on input nodes."""
    nodes = [
        {
            "id": n.id,
            "node_type": n.node_type,
            "node_name": n.node_name,
            "config_json": n.config_json,
        }
        for n in wf.nodes
    ]
    edges = [
        {"source_node_id": e.source_node_id, "target_node_id": e.target_node_id} for e in wf.edges
    ]
    errs = validate_workflow_graph(
        db=db,
        customer_id=user_customer_id,
        site_id=wf.site_id,
        workflow_id=wf.id,
        nodes=nodes,
        edges=edges,
    )
    for n in wf.nodes:
        if n.node_type == "input":
            cfg = n.config_json or {}
            raw = cfg.get("data_object_id")
            if raw:
                try:
                    did = uuid.UUID(str(raw))
                except ValueError:
                    errs.append("input node has invalid data_object_id")
                    continue
                m = validate_data_object_binding(db, user_customer_id, did)
                if m:
                    errs.append(m)
        elif n.node_type == "static":
            cfg = n.config_json or {}
            raw = cfg.get("static_ingestion_id")
            if not raw:
                errs.append(f"static node {n.id} requires static_ingestion_id")
            else:
                try:
                    sid = uuid.UUID(str(raw))
                except ValueError:
                    errs.append("static node has invalid static_ingestion_id")
                    continue
                m = validate_static_ingestion_binding(db, user_customer_id, wf.site_id, sid)
                if m:
                    errs.append(m)
    return errs
