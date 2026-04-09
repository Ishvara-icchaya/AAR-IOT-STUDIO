import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getScrubberDataObject } from "@/api/scrubber";
import * as wfApi from "@/api/workflow";
import type { WorkflowEdgeDTO, WorkflowNodeDTO } from "@/types/workflow";
import { PageStatus } from "@/components/PageStatus";
import { useDocumentThemeLight } from "@/hooks/useDocumentThemeLight";
import { PageShell } from "@/layouts/PageShell";

const PALETTE: { type: string; label: string }[] = [
  { type: "input", label: "Input" },
  { type: "filter", label: "Filter" },
  { type: "formula", label: "Formula" },
  { type: "rename", label: "Rename" },
  { type: "drop", label: "Drop" },
  { type: "join", label: "Join" },
  { type: "aggregate", label: "Aggregate" },
  { type: "health_mapping", label: "Health" },
  { type: "kpi_builder", label: "KPI" },
  { type: "terminate", label: "Terminate" },
];

type WfData = {
  nodeType: string;
  nodeName: string;
  configJson: Record<string, unknown>;
};

type JsonObj = Record<string, unknown>;

type FilterRule = { field: string; op: string; value: string };

const FILTER_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains"];

function parseLooseJson(input: string): unknown {
  const t = input.trim();
  if (!t) return "";
  try {
    return JSON.parse(t);
  } catch {
    if (!Number.isNaN(Number(t))) return Number(t);
    if (t === "true") return true;
    if (t === "false") return false;
    return t;
  }
}

function collectFieldPaths(v: unknown, prefix = "", out?: Set<string>): string[] {
  const acc = out ?? new Set<string>();
  if (!v || typeof v !== "object" || Array.isArray(v)) return [...acc];
  for (const [k, val] of Object.entries(v as JsonObj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    acc.add(p);
    if (val && typeof val === "object" && !Array.isArray(val)) collectFieldPaths(val, p, acc);
  }
  return [...acc].sort((a, b) => a.localeCompare(b));
}

function WfNode({ data, selected }: NodeProps<Node<WfData>>) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: selected ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
        background: "var(--color-surface-elevated)",
        color: "var(--color-text)",
        minWidth: 128,
        fontSize: "0.8rem",
        fontFamily: "inherit",
      }}
    >
      {data.nodeType !== "input" && <Handle type="target" position={Position.Top} />}
      <div style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>{data.nodeType}</div>
      <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{data.nodeName}</div>
      {data.nodeType !== "terminate" && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

const nodeTypes = { wf: WfNode };

/** Nodes that transform upstream JSON — show incoming payload in the inspector. */
const PROCESSING_NODE_TYPES = new Set([
  "filter",
  "formula",
  "rename",
  "drop",
  "join",
  "aggregate",
  "health_mapping",
  "kpi_builder",
]);

function upstreamPublishedObjectIds(nodes: Node<WfData>[], edges: Edge[], startNodeId: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue: string[] = [];
  for (const e of edges) {
    if (e.target === startNodeId) queue.push(e.source);
  }
  const seen = new Set<string>();
  const objectIds = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    if (n.data.nodeType === "input") {
      const oid = String((n.data.configJson as { data_object_id?: string }).data_object_id ?? "").trim();
      if (oid) objectIds.add(oid);
      continue;
    }
    for (const e of edges) {
      if (e.target === id) queue.push(e.source);
    }
  }
  return [...objectIds];
}

function toFlowNodes(nodes: WorkflowNodeDTO[]): Node<WfData>[] {
  return nodes.map((n) => ({
    id: n.id,
    type: "wf",
    position: { x: n.position_x, y: n.position_y },
    data: {
      nodeType: n.node_type,
      nodeName: n.node_name,
      configJson: { ...(n.config_json || {}) },
    },
  }));
}

function toFlowEdges(edges: WorkflowEdgeDTO[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
  }));
}

export function WorkflowEditorPage() {
  const themeLight = useDocumentThemeLight();
  const { workflowId } = useParams<{ workflowId: string }>();
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [published, setPublished] = useState(false);
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [valErrs, setValErrs] = useState<string[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WfData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [cfgText, setCfgText] = useState("{}");
  const [nameEdit, setNameEdit] = useState("");
  const [incomingJson, setIncomingJson] = useState<string | null>(null);
  const [incomingCaption, setIncomingCaption] = useState("");
  const [incomingLoading, setIncomingLoading] = useState(false);
  const [incomingErr, setIncomingErr] = useState<string | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [nodePreview, setNodePreview] = useState<JsonObj | null>(null);
  const [nodePreviewErr, setNodePreviewErr] = useState<string | null>(null);
  const [nodePreviewStatus, setNodePreviewStatus] = useState<string>("");
  const [schemaFields, setSchemaFields] = useState<string[]>([]);
  /** Output of the immediate upstream node (for field lists: formula/filter/etc. should use this, not this node's output). */
  const [upstreamPreview, setUpstreamPreview] = useState<JsonObj | null>(null);

  const load = useCallback(async () => {
    if (!workflowId) return;
    setErr(null);
    try {
      const w = await wfApi.getWorkflow(workflowId);
      if (!w) return;
      setName(w.name);
      setStatus(w.lifecycle_status);
      setPublished(w.is_published);
      setNodes(toFlowNodes(w.nodes));
      setEdges(toFlowEdges(w.edges));
      if (w.site_id) {
        const ds = await wfApi.listPublishedDataSources(w.site_id);
        setSources(ds?.items?.map((x) => ({ id: x.id, name: x.name })) ?? []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }, [workflowId, setNodes, setEdges]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedNode = nodes.find((n) => n.id === sel);
  useEffect(() => {
    if (!selectedNode) {
      setCfgText("{}");
      setNameEdit("");
      return;
    }
    setNameEdit(selectedNode.data.nodeName);
    setCfgText(JSON.stringify(selectedNode.data.configJson ?? {}, null, 2));
  }, [sel, selectedNode?.id]);

  useEffect(() => {
    const node = selectedNode;
    if (!node) {
      setIncomingJson(null);
      setIncomingCaption("");
      setIncomingErr(null);
      setIncomingLoading(false);
      return;
    }
    const nt = node.data.nodeType;
    const showIncoming = nt === "input" || PROCESSING_NODE_TYPES.has(nt);
    if (!showIncoming) {
      setIncomingJson(null);
      setIncomingCaption("");
      setIncomingErr(null);
      setIncomingLoading(false);
      return;
    }

    let cancelled = false;
    async function run(sn: Node<WfData>) {
      setIncomingLoading(true);
      setIncomingErr(null);
      setIncomingJson(null);
      setIncomingCaption("");
      try {
        let ids: string[] = [];
        if (nt === "input") {
          const oid = String(
            (sn.data.configJson as { data_object_id?: string }).data_object_id ?? "",
          ).trim();
          if (oid) ids = [oid];
        } else {
          ids = upstreamPublishedObjectIds(nodes, edges, sn.id);
        }
        if (ids.length === 0) {
          if (!cancelled) {
            setIncomingCaption(
              nt === "input"
                ? "Pick a published data object for this Input to preview the JSON that enters the workflow."
                : "Connect this node to an Input that references a published data object to preview upstream JSON.",
            );
          }
          return;
        }

        const parts: Record<string, unknown> = {};
        for (const oid of ids) {
          const row = await getScrubberDataObject(oid);
          if (cancelled) return;
          if (!row) continue;
          const blob = {
            name: row.name,
            payload: row.payload,
            kpi_json: row.kpi_json,
            health_status: row.health_status,
          };
          parts[ids.length === 1 ? "incoming" : oid] = blob;
        }
        if (cancelled) return;
        if (Object.keys(parts).length === 0) {
          setIncomingErr("Data object could not be loaded (missing or no access).");
          return;
        }
        setIncomingCaption(
          ids.length === 1
            ? "JSON from the published data object (same shape the workflow engine loads for this path)."
            : `${ids.length} upstream inputs — each block is one published data object.`,
        );
        setIncomingJson(JSON.stringify(parts, null, 2));
      } catch (e) {
        if (!cancelled) setIncomingErr(e instanceof Error ? e.message : "Could not load payload");
      } finally {
        if (!cancelled) setIncomingLoading(false);
      }
    }
    void run(node);
    return () => {
      cancelled = true;
    };
  }, [selectedNode, nodes, edges]);

  useEffect(() => {
    if (!workflowId || !selectedNode) {
      setNodePreview(null);
      setNodePreviewErr(null);
      setNodePreviewStatus("");
      setSchemaFields([]);
      setUpstreamPreview(null);
      return;
    }
    const ids = selectedNode.data.nodeType === "input"
      ? [String((selectedNode.data.configJson as { data_object_id?: string }).data_object_id ?? "")]
      : upstreamPublishedObjectIds(nodes, edges, selectedNode.id);
    const dataObjectId = ids.find((x) => x && x.trim()) ?? "";
    const wfId = workflowId;
    const nodeId = selectedNode.id;
    if (!dataObjectId) {
      setNodePreview(null);
      setNodePreviewErr(null);
      setNodePreviewStatus("");
      setSchemaFields([]);
      setUpstreamPreview(null);
      return;
    }
    let cancelled = false;
    async function run(did: string, nid: string, wid: string, flowEdges: Edge[]) {
      try {
        const res = await wfApi.testWorkflow(wid, { data_object_id: did });
        if (cancelled) return;
        const out = (res?.node_outputs?.[nid] as JsonObj | undefined) ?? null;
        setNodePreview(out);
        setNodePreviewStatus(String(res?.status ?? ""));
        setNodePreviewErr(res?.error ?? null);
        setSchemaFields(out ? collectFieldPaths(out) : []);
        const parentIds = flowEdges.filter((e) => e.target === nid).map((e) => e.source);
        if (parentIds.length === 1) {
          const up = (res?.node_outputs?.[parentIds[0]] as JsonObj | undefined) ?? null;
          setUpstreamPreview(up);
        } else {
          setUpstreamPreview(null);
        }
      } catch (e) {
        if (!cancelled) {
          setNodePreview(null);
          setUpstreamPreview(null);
          setNodePreviewStatus("");
          setSchemaFields([]);
          setNodePreviewErr(e instanceof Error ? e.message : "Preview failed");
        }
      }
    }
    void run(dataObjectId, nodeId, wfId, edges);
    return () => {
      cancelled = true;
    };
  }, [workflowId, selectedNode, nodes, edges]);

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            id: crypto.randomUUID(),
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  function addNode(t: string) {
    const id = crypto.randomUUID();
    const cfg: Record<string, unknown> =
      t === "input"
        ? { data_object_id: sources[0]?.id ?? "" }
        : t === "terminate"
          ? { terminate_name: "result_1" }
          : {};
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "wf",
        position: { x: 80 + ns.length * 24, y: 80 + ns.length * 18 },
        data: { nodeType: t, nodeName: `${t} ${ns.length + 1}`, configJson: cfg },
      },
    ]);
  }

  function patchSelectedConfig(patch: Record<string, unknown>) {
    if (!sel) return;
    setNodes((ns) =>
      ns.map((n) =>
        n.id === sel
          ? { ...n, data: { ...n.data, configJson: { ...(n.data.configJson || {}), ...patch } } }
          : n,
      ),
    );
  }

  function applySelectionEdits() {
    if (!sel) return;
    let parsed: Record<string, unknown> | null = null;
    if (advancedMode) {
      try {
        parsed = JSON.parse(cfgText) as Record<string, unknown>;
      } catch {
        setErr("Config JSON invalid");
        return;
      }
    }
    setErr(null);
    setNodes((ns) =>
      ns.map((n) =>
        n.id === sel
          ? {
              ...n,
              data: {
                ...n.data,
                nodeName: nameEdit.trim() || n.data.nodeName,
                configJson: parsed ?? n.data.configJson,
              },
            }
          : n,
      ),
    );
    setOk("Node updated locally — Save to persist.");
  }

  async function save() {
    if (!workflowId || published) return;
    setErr(null);
    setOk(null);
    const nodesPayload = nodes.map((n) => ({
      id: n.id,
      node_type: n.data.nodeType,
      node_name: n.data.nodeName,
      config_json: n.data.configJson ?? {},
      position_x: n.position.x,
      position_y: n.position.y,
    }));
    const edgesPayload = edges.map((e) => ({
      id: e.id,
      source_node_id: e.source,
      target_node_id: e.target,
    }));
    try {
      await wfApi.updateWorkflow(workflowId, {
        name,
        nodes: nodesPayload,
        edges: edgesPayload,
      });
      setOk("Saved.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function validate() {
    if (!workflowId) return;
    setValErrs([]);
    try {
      const r = await wfApi.validateWorkflow(workflowId);
      setValErrs(r?.errors ?? []);
      if (r?.valid) setOk("Validated (draft → validated).");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Validate failed");
    }
  }

  if (!workflowId) {
    return <PageShell title="Edit workflow">Missing id.</PageShell>;
  }

  const showIncomingPanel =
    selectedNode &&
    (selectedNode.data.nodeType === "input" || PROCESSING_NODE_TYPES.has(selectedNode.data.nodeType));
  const parentNodes = selectedNode ? edges.filter((e) => e.target === selectedNode.id).map((e) => nodes.find((n) => n.id === e.source)).filter(Boolean) as Node<WfData>[] : [];
  const incomingObj = (() => {
    if (!incomingJson) return null;
    try {
      return JSON.parse(incomingJson) as JsonObj;
    } catch {
      return null;
    }
  })();
  const incomingSample = (() => {
    if (!incomingObj) return null;
    if (incomingObj.incoming && typeof incomingObj.incoming === "object") {
      const p = (incomingObj.incoming as JsonObj).payload;
      if (p && typeof p === "object" && !Array.isArray(p)) return p as JsonObj;
    }
    const first = Object.values(incomingObj)[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const p = (first as JsonObj).payload;
      if (p && typeof p === "object" && !Array.isArray(p)) return p as JsonObj;
    }
    return null;
  })();
  /** Shape passed into the selected node: upstream test output when present, else input-node output / scrubber sample. */
  const payloadShapeForFields = (() => {
    if (!selectedNode) return null;
    if (selectedNode.data.nodeType === "input") {
      return nodePreview;
    }
    if (upstreamPreview) {
      return upstreamPreview;
    }
    return nodePreview ?? incomingSample ?? null;
  })();
  const availableFields = collectFieldPaths(payloadShapeForFields ?? {});
  const terminateName = selectedNode ? String((selectedNode.data.configJson as { terminate_name?: string }).terminate_name ?? "") : "";
  const terminateNameDup =
    !!selectedNode &&
    selectedNode.data.nodeType === "terminate" &&
    terminateName.trim() &&
    nodes.some(
      (n) =>
        n.id !== selectedNode.id &&
        n.data.nodeType === "terminate" &&
        String((n.data.configJson as { terminate_name?: string }).terminate_name ?? "").trim() === terminateName.trim(),
    );

  return (
    <PageShell title={`Workflow: ${name || "…"}`} className="workflow-editor-page workflow-editor-page--full">
      <div
        className="workflow-editor__toolbar"
        style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "center", flexShrink: 0 }}
      >
        <Link to="/workflow/list">← List</Link>
        <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", fontSize: "0.85rem" }}>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={published}
            style={inp}
          />
        </label>
        <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
          {status}
          {published ? " · editing locked" : ""}
        </span>
        <button type="button" style={btn} disabled={published} onClick={() => void save()}>
          Save
        </button>
        <button type="button" style={btnSec} onClick={() => void validate()}>
          Validate
        </button>
        <Link to={`/workflow/${workflowId}/test`} style={{ ...btnSec, textDecoration: "none", display: "inline-block" }}>
          Test
        </Link>
        <Link to={`/workflow/${workflowId}/live`} style={{ ...btnSec, textDecoration: "none", display: "inline-block" }}>
          Live
        </Link>
      </div>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      {ok ? <PageStatus variant="success">{ok}</PageStatus> : null}
      {valErrs.length > 0 ? (
        <PageStatus variant="error">
          <ul className="page-status__list">
            {valErrs.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </PageStatus>
      ) : null}
      <div className="workflow-editor__grid">
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "0.5rem", overflow: "auto" }}>
          <div className="workflow-palette-heading" style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.85rem" }}>
            Palette
          </div>
          {PALETTE.map((p) => (
            <button
              key={p.type}
              type="button"
              className="workflow-palette-btn"
              disabled={published}
              onClick={() => addNode(p.type)}
              style={palBtn}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="workflow-editor__canvas-wrap">
          <ReactFlow
            colorMode={themeLight ? "light" : "dark"}
            style={{ width: "100%", height: "100%" }}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={published ? undefined : onConnect}
            onNodeClick={(_, n) => setSel(n.id)}
            onPaneClick={() => setSel(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>
        <div
          className="workflow-editor-sidebar workflow-editor__sidebar"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            padding: "0.5rem",
            fontSize: "0.85rem",
            color: "var(--color-text)",
            minHeight: 0,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "var(--color-text)" }}>Node config</div>
          {!selectedNode && <span style={{ color: "var(--color-text-muted)" }}>Select a node</span>}
          {selectedNode && (
            <>
              <label style={lbl2}>
                Display name
                <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} style={inp} disabled={published} />
              </label>
              {selectedNode.data.nodeType === "input" && (
                <>
                  <label style={lbl2}>
                    Published data object
                    <select
                      value={String((selectedNode.data.configJson as { data_object_id?: string }).data_object_id ?? "")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ data_object_id: e.target.value })}
                      style={inp}
                    >
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {availableFields.length > 0 ? (
                    <label style={lbl2}>
                      Available fields
                      <select style={inp} disabled>
                        {availableFields.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              )}
              {selectedNode.data.nodeType === "filter" && (
                <>
                  <label style={lbl2}>
                    Rule logic
                    <select
                      value={String((selectedNode.data.configJson as { logic?: string }).logic ?? "AND")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ logic: e.target.value })}
                      style={inp}
                    >
                      <option value="AND">AND</option>
                      <option value="OR">OR</option>
                    </select>
                  </label>
                  {((selectedNode.data.configJson as { rules?: unknown }).rules as FilterRule[] | undefined)?.map((r, idx) => (
                    <div key={idx} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "0.35rem", marginBottom: "0.35rem" }}>
                      <div style={{ display: "grid", gap: "0.25rem" }}>
                        <select
                          style={inp}
                          value={r.field}
                          disabled={published}
                          onChange={(e) => {
                            const rules = ((selectedNode.data.configJson as { rules?: FilterRule[] }).rules ?? []).map((x) => ({ ...x }));
                            rules[idx].field = e.target.value;
                            patchSelectedConfig({ rules, field: rules[0]?.field, op: rules[0]?.op, value: parseLooseJson(rules[0]?.value ?? "") });
                          }}
                        >
                          <option value="">Select field</option>
                          {availableFields.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <select
                          style={inp}
                          value={r.op}
                          disabled={published}
                          onChange={(e) => {
                            const rules = ((selectedNode.data.configJson as { rules?: FilterRule[] }).rules ?? []).map((x) => ({ ...x }));
                            rules[idx].op = e.target.value;
                            patchSelectedConfig({ rules, op: rules[0]?.op });
                          }}
                        >
                          {FILTER_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                        </select>
                        <input
                          style={inp}
                          value={r.value}
                          disabled={published}
                          onChange={(e) => {
                            const rules = ((selectedNode.data.configJson as { rules?: FilterRule[] }).rules ?? []).map((x) => ({ ...x }));
                            rules[idx].value = e.target.value;
                            patchSelectedConfig({ rules, value: parseLooseJson(rules[0]?.value ?? "") });
                          }}
                          placeholder="Value"
                        />
                      </div>
                    </div>
                  )) ?? (
                    <button
                      type="button"
                      style={btnSec}
                      disabled={published}
                      onClick={() => patchSelectedConfig({ rules: [{ field: availableFields[0] ?? "", op: "eq", value: "" }] })}
                    >
                      Add first rule
                    </button>
                  )}
                  {Array.isArray((selectedNode.data.configJson as { rules?: unknown }).rules) ? (
                    <button
                      type="button"
                      style={btnSec}
                      disabled={published}
                      onClick={() => {
                        const rules = [...
                          (((selectedNode.data.configJson as { rules?: FilterRule[] }).rules ?? []) as FilterRule[]),
                          { field: availableFields[0] ?? "", op: "eq", value: "" },
                        ];
                        patchSelectedConfig({ rules });
                      }}
                    >
                      Add rule
                    </button>
                  ) : null}
                </>
              )}
              {selectedNode.data.nodeType === "join" && (
                <>
                  <label style={lbl2}>
                    Left input
                    <select
                      style={inp}
                      value={String((selectedNode.data.configJson as { left_input?: string }).left_input ?? parentNodes[0]?.id ?? "")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ left_input: e.target.value })}
                    >
                      {parentNodes.map((p) => (
                        <option key={p.id} value={p.id}>{p.data.nodeName}</option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl2}>
                    Right input
                    <select
                      style={inp}
                      value={String((selectedNode.data.configJson as { right_input?: string }).right_input ?? parentNodes[1]?.id ?? "")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ right_input: e.target.value })}
                    >
                      {parentNodes.map((p) => (
                        <option key={p.id} value={p.id}>{p.data.nodeName}</option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl2}>Left key<input style={inp} value={String((selectedNode.data.configJson as { left_key?: string }).left_key ?? "")} onChange={(e) => patchSelectedConfig({ left_key: e.target.value })} disabled={published} /></label>
                  <label style={lbl2}>Right key<input style={inp} value={String((selectedNode.data.configJson as { right_key?: string }).right_key ?? "")} onChange={(e) => patchSelectedConfig({ right_key: e.target.value })} disabled={published} /></label>
                  <label style={lbl2}>
                    Join type
                    <select style={inp} value={String((selectedNode.data.configJson as { join_type?: string }).join_type ?? "inner")} onChange={(e) => patchSelectedConfig({ join_type: e.target.value })} disabled={published}>
                      <option value="inner">inner</option><option value="left">left</option><option value="right">right</option><option value="full">full</option>
                    </select>
                  </label>
                  <label style={lbl2}>
                    Output handling
                    <select style={inp} value={String((selectedNode.data.configJson as { output_mode?: string }).output_mode ?? "prefix")} onChange={(e) => patchSelectedConfig({ output_mode: e.target.value })} disabled={published}>
                      <option value="prefix">Prefix fields</option><option value="retain">Retain names</option>
                    </select>
                  </label>
                </>
              )}
              {selectedNode.data.nodeType === "formula" && (
                <>
                  <label style={lbl2}>
                    Mode
                    <select style={inp} value={String((selectedNode.data.configJson as { mode?: string }).mode ?? "simple")} onChange={(e) => patchSelectedConfig({ mode: e.target.value })} disabled={published}>
                      <option value="simple">Simple formula builder</option>
                      <option value="python">Python function mode</option>
                    </select>
                  </label>
                  {parentNodes.length === 0 ? (
                    <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: "0 0 0.35rem", lineHeight: 1.4 }}>
                      Connect this node to an upstream step to resolve which fields exist on <code style={{ fontSize: "0.7rem" }}>payload</code>.
                    </p>
                  ) : (
                    <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: "0 0 0.35rem", lineHeight: 1.4 }}>
                      Incoming from <strong>{parentNodes[0].data.nodeName}</strong>
                      <span style={{ color: "var(--color-text-muted)" }}> ({parentNodes[0].data.nodeType})</span>
                    </p>
                  )}
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem", fontSize: "0.8rem" }}>Available fields</div>
                  <div
                    style={{
                      maxHeight: 140,
                      overflow: "auto",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius)",
                      padding: "0.35rem",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {availableFields.length === 0 ? (
                      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
                        Connect a published data object through an Input and save, then use Test run or the incoming preview below. Fields appear after a successful workflow test.
                      </span>
                    ) : (
                      availableFields.map((f) => (
                        <div key={f} style={{ fontSize: "0.72rem", fontFamily: "monospace", marginBottom: "0.12rem", wordBreak: "break-all" }}>
                          {f}
                        </div>
                      ))
                    )}
                  </div>
                  <details style={{ marginBottom: "0.5rem", fontSize: "0.72rem", color: "var(--color-text-muted)", lineHeight: 1.45 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--color-text)", fontSize: "0.78rem" }}>
                      How to access payload
                    </summary>
                    <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                      <li>
                        The runner calls <code style={{ fontSize: "0.7rem" }}>transform(payload)</code> with one dict copied from the upstream node. Top-level keys usually come from the published object; the test loader also adds{" "}
                        <code style={{ fontSize: "0.7rem" }}>_kpi</code> and <code style={{ fontSize: "0.7rem" }}>_health_status</code> when present.
                      </li>
                      <li>
                        Dotted paths in the list describe nesting: e.g. <code style={{ fontSize: "0.7rem" }}>a.b</code> means use{" "}
                        <code style={{ fontSize: "0.7rem" }}>{'payload["a"]["b"]'}</code> (or chained <code style={{ fontSize: "0.7rem" }}>.get()</code>) in Python — not one key named{" "}
                        <code style={{ fontSize: "0.7rem" }}>{'"a.b"'}</code>.
                      </li>
                      <li>
                        <strong>Simple mode:</strong> <code style={{ fontSize: "0.7rem" }}>set</code> merges literal values onto a copy of <code style={{ fontSize: "0.7rem" }}>payload</code> at the top level only; expressions are not evaluated.
                      </li>
                      <li>
                        <strong>Python mode:</strong> return a dict of new or updated top-level keys; scalar values are written back onto the payload (see server rules).
                      </li>
                    </ul>
                  </details>
                  {String((selectedNode.data.configJson as { mode?: string }).mode ?? "simple") === "python" ? (
                    <>
                      <label style={lbl2}>
                        Python `transform(payload)` (sandboxed)
                        <textarea
                          style={{ ...inp, fontFamily: "monospace", fontSize: "0.75rem", width: "100%" }}
                          rows={8}
                          value={String((selectedNode.data.configJson as { python_code?: string }).python_code ?? "def transform(payload):\n    return {}")}
                          onChange={(e) => patchSelectedConfig({ python_code: e.target.value })}
                          disabled={published}
                        />
                      </label>
                      <label style={lbl2}>Timeout ms<input style={inp} type="number" value={Number((selectedNode.data.configJson as { timeout_ms?: number }).timeout_ms ?? 300)} onChange={(e) => patchSelectedConfig({ timeout_ms: Number(e.target.value || 300) })} disabled={published} /></label>
                    </>
                  ) : (
                    <label style={lbl2}>
                      Simple set map (JSON object)
                      <textarea
                        style={{ ...inp, fontFamily: "monospace", fontSize: "0.75rem", width: "100%" }}
                        rows={5}
                        value={JSON.stringify((selectedNode.data.configJson as { set?: JsonObj }).set ?? {}, null, 2)}
                        onChange={(e) => {
                          try {
                            patchSelectedConfig({ set: JSON.parse(e.target.value) });
                          } catch {
                            setErr("Simple formula set must be valid JSON object");
                          }
                        }}
                        disabled={published}
                      />
                    </label>
                  )}
                </>
              )}
              {selectedNode.data.nodeType === "drop" && (
                <>
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Fields</div>
                  <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "0.35rem" }}>
                    {availableFields.map((f) => {
                      const dropSet = new Set(((selectedNode.data.configJson as { fields?: string[] }).fields ?? []).map(String));
                      const dropped = dropSet.has(f);
                      return (
                        <label key={f} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.2rem" }}>
                          <code>{f}</code>
                          <input
                            type="checkbox"
                            checked={dropped}
                            disabled={published}
                            onChange={(e) => {
                              const next = new Set(((selectedNode.data.configJson as { fields?: string[] }).fields ?? []).map(String));
                              if (e.target.checked) next.add(f); else next.delete(f);
                              patchSelectedConfig({ fields: [...next] });
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
              {selectedNode.data.nodeType === "terminate" && (
                <>
                  <label style={lbl2}>
                    Result object name
                    <input style={inp} value={terminateName} disabled={published} onChange={(e) => patchSelectedConfig({ terminate_name: e.target.value })} />
                  </label>
                  {terminateNameDup ? <PageStatus variant="error">Terminate name must be unique in this workflow.</PageStatus> : null}
                </>
              )}
              <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <button type="button" style={btn} disabled={published} onClick={applySelectionEdits}>
                  Apply node name
                </button>
                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.78rem" }}>
                  <input type="checkbox" checked={advancedMode} onChange={(e) => setAdvancedMode(e.target.checked)} />
                  Advanced JSON
                </label>
              </div>
              {advancedMode ? (
                <>
                  <label style={lbl2}>
                    config_json (debug)
                    <textarea
                      value={cfgText}
                      onChange={(e) => setCfgText(e.target.value)}
                      disabled={published}
                      rows={10}
                      style={{ ...inp, fontFamily: "monospace", fontSize: "0.75rem", width: "100%" }}
                    />
                  </label>
                  <button type="button" style={btnSec} disabled={published} onClick={applySelectionEdits}>
                    Apply debug JSON
                  </button>
                </>
              ) : null}
              <div style={{ marginTop: "0.5rem", borderTop: "1px solid var(--color-border)", paddingTop: "0.5rem" }}>
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Node preview & validation</div>
                {nodePreviewStatus ? <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Run status: {nodePreviewStatus}</div> : null}
                {nodePreviewErr ? <div style={{ fontSize: "0.75rem", color: "var(--page-status-error-fg)" }}>{nodePreviewErr}</div> : null}
                {schemaFields.length > 0 ? (
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>
                    Schema fields: {schemaFields.slice(0, 12).join(", ")}{schemaFields.length > 12 ? "…" : ""}
                  </div>
                ) : null}
                {nodePreview ? (
                  <pre style={{ margin: 0, maxHeight: 160, overflow: "auto", ...inp, fontFamily: "monospace", fontSize: "0.7rem" }}>
                    {JSON.stringify(nodePreview, null, 2)}
                  </pre>
                ) : null}
              </div>
              {showIncomingPanel ? (
                <div
                  style={{
                    marginTop: "0.75rem",
                    borderTop: "1px solid var(--color-border)",
                    paddingTop: "0.75rem",
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: "0.35rem", color: "var(--color-text)" }}>
                    Incoming data preview
                  </div>
                  <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: "0 0 0.5rem", lineHeight: 1.4 }}>
                    {incomingCaption ||
                      (incomingLoading ? "Loading published object from the scrubber API…" : "")}
                  </p>
                  {incomingLoading ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.8rem" }}>Loading…</span>
                  ) : null}
                  {incomingErr ? (
                    <span style={{ color: "var(--page-status-error-fg, #f66)", fontSize: "0.8rem" }}>{incomingErr}</span>
                  ) : null}
                  {incomingJson ? (
                    <pre
                      style={{
                        margin: 0,
                        flex: 1,
                        minHeight: 120,
                        maxHeight: "min(42vh, 360px)",
                        overflow: "auto",
                        padding: "0.5rem",
                        borderRadius: "var(--radius)",
                        border: "1px solid var(--color-border-subtle, var(--color-border))",
                        background: "var(--color-bg)",
                        color: "var(--color-text)",
                        fontSize: "0.7rem",
                        lineHeight: 1.35,
                      }}
                    >
                      {incomingJson}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}

const inp: CSSProperties = {
  padding: "0.35rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};
const btn: CSSProperties = {
  padding: "0.45rem 0.75rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
const btnSec: CSSProperties = { ...btn, background: "var(--color-border)", color: "var(--color-text)" };
const palBtn: CSSProperties = {
  display: "block",
  width: "100%",
  marginBottom: "0.35rem",
  padding: "0.4rem 0.5rem",
  borderRadius: "var(--radius)",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontFamily: "inherit",
  fontWeight: 600,
  color: "var(--color-text)",
  background: "color-mix(in oklab, var(--color-surface-elevated) 94%, var(--color-bg) 6%)",
  border: "1px solid var(--color-border)",
};
const lbl2: CSSProperties = { display: "grid", gap: "0.25rem", marginBottom: "0.5rem" };
