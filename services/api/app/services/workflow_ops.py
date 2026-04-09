"""Persist workflow graph (nodes, edges, result definitions)."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

from app.models.result_object_definition import ResultObjectDefinition
from app.models.workflow import Workflow
from app.models.workflow_edge import WorkflowEdge
from app.models.workflow_node import WorkflowNode
from app.schemas.workflow_graph import WorkflowEdgeWrite, WorkflowNodeWrite


def replace_workflow_graph(
    db: Session,
    wf: Workflow,
    nodes: list[WorkflowNodeWrite],
    edges: list[WorkflowEdgeWrite],
) -> None:
    db.execute(delete(WorkflowEdge).where(WorkflowEdge.workflow_id == wf.id))
    db.execute(delete(ResultObjectDefinition).where(ResultObjectDefinition.workflow_id == wf.id))
    db.execute(delete(WorkflowNode).where(WorkflowNode.workflow_id == wf.id))
    db.flush()

    for nw in nodes:
        db.add(
            WorkflowNode(
                id=nw.id,
                workflow_id=wf.id,
                node_type=nw.node_type,
                node_name=nw.node_name,
                config_json=dict(nw.config_json),
                position_x=nw.position_x,
                position_y=nw.position_y,
            )
        )
    db.flush()

    for ew in edges:
        db.add(
            WorkflowEdge(
                id=ew.id,
                workflow_id=wf.id,
                source_node_id=ew.source_node_id,
                target_node_id=ew.target_node_id,
            )
        )

    for nw in nodes:
        if nw.node_type != "terminate":
            continue
        cfg = nw.config_json or {}
        tname = str(cfg.get("terminate_name") or "").strip()
        if not tname:
            continue
        schema = cfg.get("output_schema") if isinstance(cfg.get("output_schema"), dict) else {}
        db.add(
            ResultObjectDefinition(
                workflow_id=wf.id,
                terminate_node_id=nw.id,
                result_object_name=tname,
                schema_json=dict(schema),
            )
        )


def load_workflow_eager(db: Session, workflow_id: uuid.UUID) -> Workflow | None:
    stmt = (
        select(Workflow)
        .where(Workflow.id == workflow_id)
        .options(
            joinedload(Workflow.nodes),
            joinedload(Workflow.edges),
            joinedload(Workflow.result_definitions),
        )
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def duplicate_workflow(db: Session, wf: Workflow, *, new_name: str, user_id: uuid.UUID | None) -> Workflow:
    """Deep copy graph with new node and edge ids."""
    wf = load_workflow_eager(db, wf.id)
    assert wf is not None
    id_map: dict[uuid.UUID, uuid.UUID] = {}
    for n in wf.nodes:
        id_map[n.id] = uuid.uuid4()

    nw = Workflow(
        customer_id=wf.customer_id,
        site_id=wf.site_id,
        name=new_name[:255],
        description=wf.description,
        definition=dict(wf.definition or {}),
        lifecycle_status="draft",
        version=1,
        is_published=False,
        created_by_user_id=user_id,
    )
    db.add(nw)
    db.flush()

    for n in wf.nodes:
        db.add(
            WorkflowNode(
                id=id_map[n.id],
                workflow_id=nw.id,
                node_type=n.node_type,
                node_name=n.node_name,
                config_json=dict(n.config_json or {}),
                position_x=n.position_x,
                position_y=n.position_y,
            )
        )
    db.flush()

    for e in wf.edges:
        db.add(
            WorkflowEdge(
                id=uuid.uuid4(),
                workflow_id=nw.id,
                source_node_id=id_map[e.source_node_id],
                target_node_id=id_map[e.target_node_id],
            )
        )

    for n in wf.nodes:
        if n.node_type != "terminate":
            continue
        cfg = n.config_json or {}
        tname = str(cfg.get("terminate_name") or "").strip()
        if not tname:
            continue
        schema = cfg.get("output_schema") if isinstance(cfg.get("output_schema"), dict) else {}
        db.add(
            ResultObjectDefinition(
                workflow_id=nw.id,
                terminate_node_id=id_map[n.id],
                result_object_name=tname,
                schema_json=dict(schema),
            )
        )

    db.flush()
    return load_workflow_eager(db, nw.id) or nw
