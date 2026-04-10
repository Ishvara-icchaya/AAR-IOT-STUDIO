"""Deterministic workflow graph execution (API tests + worker runtime)."""

from __future__ import annotations

import ast
import concurrent.futures
import math
import uuid
from collections import defaultdict, deque
from copy import deepcopy
from typing import Any, Callable

NODE_TYPES = frozenset(
    {
        "input",
        "static",
        "filter",
        "formula",
        "rename",
        "drop",
        "join",
        "aggregate",
        "health_mapping",
        "kpi_builder",
        "terminate",
    }
)


class WorkflowGraphError(ValueError):
    pass


def _as_dict(d: Any) -> dict[str, Any]:
    return d if isinstance(d, dict) else {}


def _coerce_scalar(v: Any) -> Any:
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    return str(v)


def _coerce_num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and v.strip():
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def _run_with_timeout(fn: Any, timeout_ms: int) -> Any:
    ms = 300 if timeout_ms <= 0 else min(timeout_ms, 3000)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(fn)
        try:
            return fut.result(timeout=ms / 1000.0)
        except concurrent.futures.TimeoutError as e:
            raise WorkflowGraphError("formula python timed out") from e


def topological_order(
    node_ids: set[uuid.UUID],
    edges: list[tuple[uuid.UUID, uuid.UUID]],
) -> list[uuid.UUID]:
    adj: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    indeg: dict[uuid.UUID, int] = defaultdict(int)
    for nid in node_ids:
        indeg[nid] = 0
    for a, b in edges:
        if a not in node_ids or b not in node_ids:
            continue
        adj[a].append(b)
        indeg[b] += 1
    q = deque([n for n in node_ids if indeg[n] == 0])
    out: list[uuid.UUID] = []
    while q:
        n = q.popleft()
        out.append(n)
        for v in adj[n]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(out) != len(node_ids):
        raise WorkflowGraphError("graph cycle or disconnected subgraph")
    return out


def run_static(
    config: dict[str, Any],
    load_static_ingestion: Callable[[uuid.UUID], dict[str, Any]],
) -> dict[str, Any]:
    raw_id = config.get("static_ingestion_id")
    if not raw_id:
        raise WorkflowGraphError("static node requires config.static_ingestion_id")
    try:
        sid = uuid.UUID(str(raw_id))
    except ValueError as e:
        raise WorkflowGraphError("invalid static_ingestion_id") from e
    return deepcopy(load_static_ingestion(sid))


def run_input(
    config: dict[str, Any],
    load_data_object: Callable[[uuid.UUID], dict[str, Any]],
) -> dict[str, Any]:
    raw_id = config.get("data_object_id")
    if not raw_id:
        raise WorkflowGraphError("input node requires config.data_object_id")
    try:
        did = uuid.UUID(str(raw_id))
    except ValueError as e:
        raise WorkflowGraphError("invalid data_object_id") from e
    return load_data_object(did)


def _eval_filter_rule(payload: dict[str, Any], rule: dict[str, Any]) -> bool:
    field = str(rule.get("field") or "").strip()
    if not field:
        return False
    op = str(rule.get("op") or "eq").lower()
    val = rule.get("value")
    cur = payload.get(field)
    if op == "eq":
        return cur == val
    if op == "ne":
        return cur != val
    if op in ("contains", "not_contains"):
        a = str(cur) if cur is not None else ""
        b = str(val) if val is not None else ""
        hit = b in a
        return hit if op == "contains" else (not hit)
    ncur = _coerce_num(cur)
    nval = _coerce_num(val)
    if ncur is None or nval is None:
        return False
    if op == "gt":
        return ncur > nval
    if op == "gte":
        return ncur >= nval
    if op == "lt":
        return ncur < nval
    if op == "lte":
        return ncur <= nval
    return cur == val


def run_filter(payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any] | None:
    rules_raw = config.get("rules")
    if isinstance(rules_raw, list) and rules_raw:
        rules = [r for r in rules_raw if isinstance(r, dict)]
        if not rules:
            return payload
        logic = str(config.get("logic") or "AND").upper()
        verdicts = [_eval_filter_rule(payload, r) for r in rules]
        ok = all(verdicts) if logic != "OR" else any(verdicts)
        return payload if ok else None
    return payload if _eval_filter_rule(payload, config) else None


def run_formula(payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    out = deepcopy(payload)
    mode = str(config.get("mode") or "simple").lower()
    if mode == "python":
        code = config.get("python_code")
        if not isinstance(code, str) or not code.strip():
            return out
        try:
            tree = ast.parse(code, mode="exec")
        except SyntaxError as e:
            raise WorkflowGraphError(f"formula python syntax error: {e.msg}") from e
        for n in ast.walk(tree):
            if isinstance(n, (ast.Import, ast.ImportFrom)):
                raise WorkflowGraphError("formula python imports are not allowed")
        safe_builtins = {"len": len, "int": int, "float": float, "str": str, "bool": bool}
        helpers = {
            "abs": abs,
            "round": round,
            "min": min,
            "max": max,
            "sum": sum,
            "pow": pow,
            "sqrt": math.sqrt,
        }
        glb: dict[str, Any] = {"__builtins__": safe_builtins}
        glb.update(helpers)
        lcl: dict[str, Any] = {}
        exec(compile(tree, "<workflow-formula>", "exec"), glb, lcl)
        fn = lcl.get("transform") or glb.get("transform")
        if not callable(fn):
            raise WorkflowGraphError("formula python must define transform(payload)")
        timeout = int(config.get("timeout_ms") or 300)
        p_out = _run_with_timeout(lambda: fn(payload), timeout)
        if not isinstance(p_out, dict):
            raise WorkflowGraphError("formula python must return dict")
        for k, v in p_out.items():
            if not isinstance(k, str) or not k.strip():
                continue
            out[k] = _coerce_scalar(v)
        return out
    inner = _as_dict(config.get("set"))
    for k, v in inner.items():
        out[str(k)] = _coerce_scalar(v)
    return out


def run_rename(payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    m = _as_dict(config.get("map"))
    data = deepcopy(payload)
    for old, new in m.items():
        if old in data:
            data[str(new)] = data.pop(old)
    return data


def run_drop(payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    fields = config.get("fields")
    if not isinstance(fields, list):
        return payload
    data = deepcopy(payload)
    for f in fields:
        data.pop(str(f), None)
    return data


def run_join(inputs: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
    if len(inputs) < 2:
        raise WorkflowGraphError("join requires two upstream payloads")
    left, right = inputs[0], inputs[1]
    lk = str(config.get("left_prefix") or "left_")
    rk = str(config.get("right_prefix") or "right_")
    left_key = str(config.get("left_key") or "").strip()
    right_key = str(config.get("right_key") or "").strip()
    join_type = str(config.get("join_type") or "inner").lower()
    output_mode = str(config.get("output_mode") or "prefix").lower()
    matched = True
    if left_key and right_key:
        matched = left.get(left_key) == right.get(right_key)
    if join_type == "inner" and not matched:
        return {}
    if join_type == "left" and not matched:
        right = {}
    if join_type == "right" and not matched:
        left = {}
    out: dict[str, Any] = {}
    if output_mode == "retain":
        out.update(left)
        for k, v in right.items():
            if k in out:
                out[f"{rk}{k}"] = v
            else:
                out[k] = v
    else:
        for k, v in left.items():
            out[f"{lk}{k}"] = v
        for k, v in right.items():
            out[f"{rk}{k}"] = v
    return out


def run_aggregate(payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    op = str(config.get("op") or "count")
    field = config.get("field")
    data = deepcopy(payload)
    if op == "count":
        arr = payload.get(field) if field else None
        if isinstance(arr, list):
            data["aggregate_count"] = len(arr)
        else:
            data["aggregate_count"] = 1
    elif op in ("sum", "avg", "min", "max") and field:
        arr = payload.get(field)
        if isinstance(arr, list) and arr:
            nums = [float(x) for x in arr if isinstance(x, (int, float))]
            if nums:
                if op == "sum":
                    data["aggregate_value"] = sum(nums)
                elif op == "avg":
                    data["aggregate_value"] = sum(nums) / len(nums)
                elif op == "min":
                    data["aggregate_value"] = min(nums)
                else:
                    data["aggregate_value"] = max(nums)
    return data


def run_health_mapping(payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    data = deepcopy(payload)
    rules = _as_dict(config.get("normalize"))
    status = str(rules.get("health_status") or payload.get("health_status") or "green")
    data["health_status"] = status[:16]
    data["health_severity"] = rules.get("health_severity", payload.get("health_severity", 0))
    data["health_code"] = str(rules.get("health_code") or payload.get("health_code") or "ok")[:64]
    data["health_message"] = str(rules.get("health_message") or payload.get("health_message") or "")[:2000]
    data["health_blink"] = bool(rules.get("health_blink", False))
    return data


def run_kpi_builder(payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    data = deepcopy(payload)
    kpis = _as_dict(config.get("values"))
    for k, v in kpis.items():
        if isinstance(v, (int, float)):
            data[f"kpi_{k}"] = float(v)
    return data


def run_terminate(
    payload: dict[str, Any], config: dict[str, Any], node_id: uuid.UUID
) -> dict[str, Any]:
    name = config.get("terminate_name")
    if not name or not str(name).strip():
        raise WorkflowGraphError("terminate node requires terminate_name")
    return {
        "_terminate_name": str(name).strip(),
        "_payload": deepcopy(payload),
        "_terminate_node_id": str(node_id),
    }


def execute_graph(
    *,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    load_data_object: Callable[[uuid.UUID], dict[str, Any]],
    load_static_ingestion: Callable[[uuid.UUID], dict[str, Any]] | None = None,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], str | None]:
    """
    nodes: {id, node_type, config_json}
    edges: {source_node_id, target_node_id}
    Returns (node_outputs keyed by str(node_id), result_objects list, error_message)
    """
    by_id: dict[uuid.UUID, dict[str, Any]] = {}
    for n in nodes:
        nid = uuid.UUID(str(n["id"]))
        by_id[nid] = n
    node_ids = set(by_id)
    edge_pairs: list[tuple[uuid.UUID, uuid.UUID]] = []
    preds: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for e in edges:
        a = uuid.UUID(str(e["source_node_id"]))
        b = uuid.UUID(str(e["target_node_id"]))
        edge_pairs.append((a, b))
        preds[b].append(a)

    try:
        order = topological_order(node_ids, edge_pairs)
    except WorkflowGraphError as e:
        return {}, [], str(e)

    outputs: dict[str, dict[str, Any]] = {}
    results: list[dict[str, Any]] = []

    for nid in order:
        n = by_id[nid]
        ntype = str(n.get("node_type") or "")
        cfg = _as_dict(n.get("config_json"))
        parents = preds.get(nid, [])

        try:
            if ntype == "input":
                out = run_input(cfg, load_data_object)
            elif ntype == "static":
                if len(parents) != 0:
                    raise WorkflowGraphError("static node must not have incoming edges")
                if load_static_ingestion is None:
                    raise WorkflowGraphError("static ingestion loader not configured")
                out = run_static(cfg, load_static_ingestion)
            elif ntype == "filter":
                if len(parents) != 1:
                    raise WorkflowGraphError("filter requires exactly one parent")
                pin = outputs[str(parents[0])]
                filt = run_filter(pin, cfg)
                if filt is None:
                    return outputs, results, "filtered_out"
                out = filt
            elif ntype == "formula":
                if len(parents) != 1:
                    raise WorkflowGraphError("formula requires one parent")
                out = run_formula(outputs[str(parents[0])], cfg)
            elif ntype == "rename":
                if len(parents) != 1:
                    raise WorkflowGraphError("rename requires one parent")
                out = run_rename(outputs[str(parents[0])], cfg)
            elif ntype == "drop":
                if len(parents) != 1:
                    raise WorkflowGraphError("drop requires one parent")
                out = run_drop(outputs[str(parents[0])], cfg)
            elif ntype == "join":
                if len(parents) < 2:
                    raise WorkflowGraphError("join requires two parents")
                pin = [outputs[str(p)] for p in parents[:2]]
                out = run_join(pin, cfg)
            elif ntype == "aggregate":
                if len(parents) != 1:
                    raise WorkflowGraphError("aggregate requires one parent")
                out = run_aggregate(outputs[str(parents[0])], cfg)
            elif ntype == "health_mapping":
                if len(parents) != 1:
                    raise WorkflowGraphError("health_mapping requires one parent")
                out = run_health_mapping(outputs[str(parents[0])], cfg)
            elif ntype == "kpi_builder":
                if len(parents) != 1:
                    raise WorkflowGraphError("kpi_builder requires one parent")
                out = run_kpi_builder(outputs[str(parents[0])], cfg)
            elif ntype == "terminate":
                if len(parents) != 1:
                    raise WorkflowGraphError("terminate requires one parent")
                out = run_terminate(outputs[str(parents[0])], cfg, nid)
                results.append(
                    {
                        "result_object_name": out["_terminate_name"],
                        "payload": out["_payload"],
                        "terminate_node_id": out["_terminate_node_id"],
                    }
                )
                out = out["_payload"]
            else:
                raise WorkflowGraphError(f"unknown node type: {ntype}")
        except WorkflowGraphError as e:
            return outputs, results, str(e)

        outputs[str(nid)] = out

    return outputs, results, None
