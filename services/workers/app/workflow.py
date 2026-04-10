"""worker-workflow — consume data_object.created, run published workflows."""

from __future__ import annotations

import json
import logging
import os

from kafka import KafkaConsumer

from app._kafka import bootstrap_servers
from app.alert_dedupe import workflow_failure_cooldown_allows
from app.alert_emit import emit_alert as worker_emit_alert
from app.kafka_publish import emit_result_object_created, emit_workflow_object_created
from app.logging_setup import configure_logging
from app.pipeline import emit
from app.workflow_graph_run import WorkflowGraphError, execute_graph
from app.workflow_persist import (
    find_published_workflows_for_data_object,
    insert_execution_completed,
    insert_result_object_row,
    load_data_object_payload,
    load_static_ingestion_payload,
    load_workflow_graph,
)
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def _topic_in() -> str:
    return os.environ.get("KAFKA_DATA_OBJECT_CREATED_TOPIC", "data_object.created")


def _process_event(data: dict) -> None:
    if data.get("kind") not in (None, "data_object_created"):
        return
    data_object_id = str(data.get("data_object_id") or "")
    customer_id = str(data.get("customer_id") or "")
    site_id = str(data.get("site_id") or "")
    trace_id = data.get("trace_id")
    trace_s = str(trace_id)[:64] if trace_id else None

    if not data_object_id or not customer_id or not site_id:
        log.warning("workflow skip event missing ids")
        return

    wf_ids = find_published_workflows_for_data_object(
        customer_id=customer_id, site_id=site_id, data_object_id=data_object_id
    )
    if not wf_ids:
        emit(
            log,
            component="worker-workflow",
            action="no_matching_workflow",
            status="ok",
            data_object_id=data_object_id,
            site_id=site_id,
        )
        return

    for wf_id in wf_ids:
        nodes, edges = load_workflow_graph(workflow_id=wf_id)
        exec_nodes = [
            {"id": n["id"], "node_type": n["node_type"], "config_json": dict(n.get("config_json") or {})}
            for n in nodes
        ]
        exec_edges = [
            {"source_node_id": e["source_node_id"], "target_node_id": e["target_node_id"]}
            for e in edges
        ]

        def load_obj(did):
            pl = load_data_object_payload(data_object_id=str(did), customer_id=customer_id)
            if pl is None:
                # Unpublished, inactive lineage, or retired operational scope — skip without error alerts.
                raise WorkflowGraphError("filtered_out")
            return pl

        def load_static(sid):
            pl = load_static_ingestion_payload(
                static_ingestion_id=str(sid), customer_id=customer_id
            )
            if pl is None:
                raise WorkflowGraphError("static ingestion not found or inactive")
            return pl

        outs, results, err = execute_graph(
            nodes=exec_nodes,
            edges=exec_edges,
            load_data_object=load_obj,
            load_static_ingestion=load_static,
        )
        st = "success"
        if err == "filtered_out":
            st = "filtered_out"
        elif err:
            st = "error"

        serial_outs = {k: v for k, v in outs.items() if isinstance(v, dict)}

        eid = insert_execution_completed(
            workflow_id=wf_id,
            input_data_object_id=data_object_id,
            trigger_type="data_object_created",
            status=st,
            trace_id=trace_s,
            node_outputs=serial_outs,
            error_message=err,
        )

        emit(
            log,
            component="worker-workflow",
            action="execution_persisted",
            status="ok" if st == "success" else "error",
            workflow_id=wf_id,
            execution_id=eid,
            trace_id=trace_s,
        )

        if st == "error" and err and err != "filtered_out":
            try:
                if workflow_failure_cooldown_allows(customer_id=customer_id, workflow_id=wf_id):
                    worker_emit_alert(
                        category="workflow",
                        severity="warning",
                        title="Workflow execution failed",
                        message=str(err)[:2000],
                        customer_id=customer_id,
                        site_id=site_id,
                        source_component="worker-workflow",
                        source_object_type="workflow_execution",
                        source_object_id=eid,
                        trace_id=trace_s,
                    )
            except Exception:
                log.exception("workflow failure alert emit failed")

        try:
            emit_workflow_object_created(
                payload={
                    "kind": "workflow_object_created",
                    "workflow_execution_id": eid,
                    "workflow_id": wf_id,
                    "data_object_id": data_object_id,
                    "status": st,
                    "trace_id": trace_s,
                }
            )
        except Exception:
            log.exception("emit workflow_object.created failed")

        for r in results:
            pname = str(r.get("result_object_name") or "")
            pl = r.get("payload") if isinstance(r.get("payload"), dict) else {}
            tid = r.get("terminate_node_id")
            hs = pl.get("health_status") or pl.get("_health_status")
            rid = insert_result_object_row(
                execution_id=eid,
                workflow_id=wf_id,
                terminate_node_id=str(tid) if tid else None,
                result_object_name=pname,
                customer_id=customer_id,
                site_id=site_id,
                payload=pl,
                health_status=str(hs)[:16] if hs else None,
            )
            try:
                emit_result_object_created(
                    payload={
                        "kind": "result_object_created",
                        "result_object_id": rid,
                        "workflow_execution_id": eid,
                        "workflow_id": wf_id,
                        "result_object_name": pname,
                        "customer_id": customer_id,
                        "site_id": site_id,
                        "trace_id": trace_s,
                    }
                )
            except Exception:
                log.exception("emit result_object.created failed")


def main() -> None:
    log.debug("worker-workflow main() starting")
    servers = bootstrap_servers()
    consumer = KafkaConsumer(
        _topic_in(),
        bootstrap_servers=servers,
        group_id="worker-workflow",
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda b: b,
    )
    emit(
        log,
        component="worker-workflow",
        action="subscriber_started",
        status="ok",
        topic=_topic_in(),
        group_id="worker-workflow",
    )
    log.info("worker-workflow listening on %s", _topic_in())
    start_worker_heartbeat("worker-workflow")
    for msg in consumer:
        vb = len(msg.value) if msg.value else 0
        emit(
            log,
            component="worker-workflow",
            action="payload_received",
            status="ok",
            topic=msg.topic,
            partition=msg.partition,
            offset=msg.offset,
            value_bytes=vb,
        )
        if not msg.value:
            continue
        try:
            data = json.loads(msg.value.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            log.warning("workflow invalid json: %s", e)
            continue
        if not isinstance(data, dict):
            continue
        try:
            _process_event(data)
        except Exception:
            log.exception("workflow process failed")


if __name__ == "__main__":
    main()
