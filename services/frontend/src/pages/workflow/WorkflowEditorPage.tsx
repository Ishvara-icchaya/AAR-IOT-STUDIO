import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
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
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getScrubberDataObject, listDataObjectDetails } from "@/api/scrubber";
import { listDevices } from "@/api/devices";
import { getStaticIngestion, listStaticIngestions } from "@/api/staticIngestion";
import * as wfApi from "@/api/workflow";
import type { WorkflowEdgeDTO, WorkflowNodeDTO } from "@/types/workflow";
import { WorkflowFormulaBuilderPanel } from "@/components/workflow/WorkflowFormulaBuilderPanel";
import { ConfigDrawer } from "@/components/ops/ConfigDrawer";
import { PageStatus } from "@/components/PageStatus";
import type { FormulaBuilderRow } from "@/lib/workflowFormulaCodegen";
import {
  defaultFormulaBuilderRows,
  generatePythonFromRows,
  validatePythonFormulaShape,
  WORKFLOW_FORMULA_PYTHON_EXAMPLE,
} from "@/lib/workflowFormulaCodegen";
import { useDocumentThemeLight } from "@/hooks/useDocumentThemeLight";
import { PageShell } from "@/layouts/PageShell";
import { AppButton, AppToolbar, appButtonClassName } from "@/components/app";

const PALETTE: { type: string; label: string }[] = [
  { type: "input", label: "Input" },
  { type: "static", label: "Static" },
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

type PublishedSourceRow = { id: string; name: string; device_id: string };

/** Preview: prefer newest observed detail; fall back to mirrored data object row. */
async function loadWorkflowInputPreviewBlob(dataObjectId: string): Promise<{
  name: string;
  payload: Record<string, unknown>;
  kpi_json: Record<string, unknown>;
  health_status: string | null;
}> {
  try {
    const d = await listDataObjectDetails(dataObjectId, { page: 1, page_size: 1 });
    const first = d?.items?.[0];
    const pj = first?.payload_json;
    if (first && pj && typeof pj === "object" && !Array.isArray(pj)) {
      return {
        name: "Latest observed sample",
        payload: pj,
        kpi_json:
          first.kpi_json && typeof first.kpi_json === "object" && !Array.isArray(first.kpi_json)
            ? (first.kpi_json as Record<string, unknown>)
            : {},
        health_status: first.health_status ?? null,
      };
    }
  } catch {
    /* use mirror */
  }
  const row = await getScrubberDataObject(dataObjectId);
  if (!row) {
    return { name: "Unavailable", payload: {}, kpi_json: {}, health_status: null };
  }
  return {
    name: row.name,
    payload: row.payload,
    kpi_json: row.kpi_json ?? {},
    health_status: row.health_status,
  };
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
        padding: "3px 5px",
        borderRadius: 6,
        border: selected ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
        background: "var(--color-surface-elevated)",
        color: "var(--color-text)",
        minWidth: 52,
        fontSize: "0.72rem",
        fontFamily: "inherit",
      }}
    >
      {data.nodeType !== "input" && data.nodeType !== "static" && <Handle type="target" position={Position.Top} />}
      <div style={{ color: "var(--color-text-muted)", fontSize: "0.62rem" }}>{data.nodeType}</div>
      <div style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "0.72rem" }}>{data.nodeName}</div>
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

function upstreamSourceIds(
  nodes: Node<WfData>[],
  edges: Edge[],
  startNodeId: string,
): { dataObjectIds: string[]; staticIngestionIds: string[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue: string[] = [];
  for (const e of edges) {
    if (e.target === startNodeId) queue.push(e.source);
  }
  const seen = new Set<string>();
  const dataObjectIds = new Set<string>();
  const staticIngestionIds = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    if (n.data.nodeType === "input") {
      const oid = String((n.data.configJson as { data_object_id?: string }).data_object_id ?? "").trim();
      if (oid) dataObjectIds.add(oid);
      continue;
    }
    if (n.data.nodeType === "static") {
      const sid = String((n.data.configJson as { static_ingestion_id?: string }).static_ingestion_id ?? "").trim();
      if (sid) staticIngestionIds.add(sid);
      continue;
    }
    for (const e of edges) {
      if (e.target === id) queue.push(e.source);
    }
  }
  return { dataObjectIds: [...dataObjectIds], staticIngestionIds: [...staticIngestionIds] };
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

function parseFormulaBuilderRows(cfg: Record<string, unknown>): FormulaBuilderRow[] {
  const raw = cfg.formula_builder_rows;
  if (!Array.isArray(raw) || raw.length === 0) return defaultFormulaBuilderRows();
  const out: FormulaBuilderRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const op = String(o.op ?? "copy");
    out.push({
      id: String(o.id || crypto.randomUUID()),
      outputKey: String(o.outputKey ?? ""),
      op: op as FormulaBuilderRow["op"],
      leftPath: String(o.leftPath ?? ""),
      rightKind: o.rightKind === "path" ? "path" : "literal",
      literal: String(o.literal ?? ""),
      rightPath: String(o.rightPath ?? ""),
    });
  }
  return out.length ? out : defaultFormulaBuilderRows();
}

function inferFormulaPanel(cfg: Record<string, unknown>): "visual" | "python" | "legacy" {
  const ex = cfg.formula_panel;
  if (ex === "visual" || ex === "python" || ex === "legacy") return ex;
  if (Array.isArray(cfg.formula_builder_rows) && (cfg.formula_builder_rows as unknown[]).length > 0) return "visual";
  if (String(cfg.mode ?? "") === "python") return "python";
  if (String(cfg.mode ?? "simple") === "simple" && "set" in cfg) return "legacy";
  return "visual";
}

type WorkflowFlowCanvasProps = {
  published: boolean;
  publishedSources: PublishedSourceRow[];
  staticSources: { id: string; name: string }[];
  setNodes: Dispatch<SetStateAction<Node<WfData>[]>>;
  themeLight: boolean;
  nodes: Node<WfData>[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node<WfData>>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (c: Connection) => void;
  setSel: (id: string | null) => void;
};

function WorkflowFlowCanvas({
  published,
  publishedSources,
  staticSources,
  setNodes,
  themeLight,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  setSel,
}: WorkflowFlowCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();

  function addNode(t: string) {
    const id = crypto.randomUUID();
    const cfg: Record<string, unknown> =
      t === "input"
        ? { data_object_id: publishedSources[0]?.id ?? "" }
        : t === "static"
          ? { static_ingestion_id: staticSources[0]?.id ?? "" }
          : t === "terminate"
            ? { terminate_name: "result_1" }
            : {};
    let position = { x: 120, y: 120 };
    const wrap = document.querySelector(".workflow-editor__canvas-wrap");
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      const p = screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      position = { x: p.x - 26, y: p.y - 22 };
    }
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "wf",
        position,
        data: { nodeType: t, nodeName: `${t} ${ns.length + 1}`, configJson: cfg },
      },
    ]);
  }

  return (
    <div className="workflow-editor__grid">
      <div className="app-palette-stack">
        <div className="workflow-palette-heading app-palette-stack__title">Palette</div>
        {PALETTE.map((p) => (
          <button
            key={p.type}
            type="button"
            className="workflow-palette-btn app-palette-btn"
            disabled={published}
            onClick={() => addNode(p.type)}
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
    </div>
  );
}

export function WorkflowEditorPage() {
  const themeLight = useDocumentThemeLight();
  const { workflowId } = useParams<{ workflowId: string }>();
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [published, setPublished] = useState(false);
  const [publishedSources, setPublishedSources] = useState<PublishedSourceRow[]>([]);
  const [deviceNameById, setDeviceNameById] = useState<Map<string, string>>(() => new Map());
  const [staticSources, setStaticSources] = useState<{ id: string; name: string }[]>([]);
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
  /** Output of the immediate upstream node (for field lists: formula/filter/etc. should use this, not this node's output). */
  const [upstreamPreview, setUpstreamPreview] = useState<JsonObj | null>(null);
  const [formulaValidateMsg, setFormulaValidateMsg] = useState<string | null>(null);
  const [formulaValidateBusy, setFormulaValidateBusy] = useState(false);

  /** One row per device (published data objects are listed newest-first; first per device wins). */
  const inputDeviceOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { deviceId: string; dataObjectId: string; label: string }[] = [];
    for (const r of publishedSources) {
      if (seen.has(r.device_id)) continue;
      seen.add(r.device_id);
      out.push({
        deviceId: r.device_id,
        dataObjectId: r.id,
        label: deviceNameById.get(r.device_id) ?? `Device ${r.device_id.slice(0, 8)}…`,
      });
    }
    return out;
  }, [publishedSources, deviceNameById]);

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
        const [ds, ss, devs] = await Promise.all([
          wfApi.listPublishedDataSources(w.site_id),
          listStaticIngestions({ site_id: w.site_id, active_only: true }),
          listDevices({ site_id: w.site_id }),
        ]);
        setPublishedSources(
          ds?.items?.map((x) => ({ id: x.id, name: x.name, device_id: x.device_id })) ?? [],
        );
        setDeviceNameById(new Map(devs.map((d) => [d.id, d.name])));
        const devNames = new Map(devs.map((d) => [d.id, d.name]));
        setStaticSources(
          ss?.items?.map((x) => ({
            id: x.id,
            name: x.device_id
              ? `${x.name} — ${devNames.get(x.device_id) ?? x.device_id}`
              : `${x.name} (site-wide)`,
          })) ?? [],
        );
      } else {
        setPublishedSources([]);
        setDeviceNameById(new Map());
        setStaticSources([]);
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
    setFormulaValidateMsg(null);
  }, [sel]);
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
    const showIncoming = nt === "input" || nt === "static" || PROCESSING_NODE_TYPES.has(nt);
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
        let dataIds: string[] = [];
        let staticIds: string[] = [];
        if (nt === "input") {
          const oid = String(
            (sn.data.configJson as { data_object_id?: string }).data_object_id ?? "",
          ).trim();
          if (oid) dataIds = [oid];
        } else if (nt === "static") {
          const sid = String(
            (sn.data.configJson as { static_ingestion_id?: string }).static_ingestion_id ?? "",
          ).trim();
          if (sid) staticIds = [sid];
        } else {
          const up = upstreamSourceIds(nodes, edges, sn.id);
          dataIds = up.dataObjectIds;
          staticIds = up.staticIngestionIds;
        }
        if (dataIds.length === 0 && staticIds.length === 0) {
          if (!cancelled) {
            setIncomingCaption(
              nt === "input"
                ? "Choose a device for this Input. Preview uses the latest observed payload, or the published mirror if no samples exist yet."
                : nt === "static"
                  ? "Choose a static ingestion definition for this node."
                  : "Connect this node to an Input or Static source to preview upstream JSON.",
            );
          }
          return;
        }

        const parts: Record<string, unknown> = {};
        for (const oid of dataIds) {
          const row = await loadWorkflowInputPreviewBlob(oid);
          if (cancelled) return;
          if (!row) continue;
          const blob = {
            name: row.name,
            payload: row.payload,
            kpi_json: row.kpi_json,
            health_status: row.health_status,
          };
          parts[dataIds.length === 1 && staticIds.length === 0 ? "incoming" : `data_object:${oid}`] = blob;
        }
        for (const sid of staticIds) {
          const row = await getStaticIngestion(sid);
          if (cancelled) return;
          if (!row) continue;
          parts[staticIds.length === 1 && dataIds.length === 0 ? "incoming" : `static:${sid}`] = {
            name: row.name,
            payload: row.payload_json,
          };
        }
        if (cancelled) return;
        if (Object.keys(parts).length === 0) {
          setIncomingErr("Upstream payload could not be loaded (missing or no access).");
          return;
        }
        setIncomingCaption(
          dataIds.length + staticIds.length === 1
            ? "JSON from the upstream source (Input uses latest observed payload when available)."
            : `${dataIds.length + staticIds.length} upstream sources — each block is one payload.`,
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
      setUpstreamPreview(null);
      return;
    }
    const nt = selectedNode.data.nodeType;
    const wfId = workflowId;
    const nodeId = selectedNode.id;

    const up =
      nt === "input"
        ? {
            dataObjectIds: [
              String((selectedNode.data.configJson as { data_object_id?: string }).data_object_id ?? ""),
            ],
            staticIngestionIds: [] as string[],
          }
        : upstreamSourceIds(nodes, edges, selectedNode.id);
    const dataObjectId = up.dataObjectIds.find((x) => x && x.trim()) ?? "";
    const canPreview =
      nt === "static"
        ? Boolean(
            String((selectedNode.data.configJson as { static_ingestion_id?: string }).static_ingestion_id ?? "").trim(),
          )
        : Boolean(dataObjectId) || up.staticIngestionIds.length > 0;

    if (!canPreview) {
      setNodePreview(null);
      setUpstreamPreview(null);
      return;
    }
    let cancelled = false;
    async function run(nid: string, wid: string, flowEdges: Edge[]) {
      try {
        const testBody = dataObjectId
          ? { data_object_id: dataObjectId, use_latest_observed_payload: true }
          : {};
        const res = await wfApi.testWorkflow(wid, testBody);
        if (cancelled) return;
        const out = (res?.node_outputs?.[nid] as JsonObj | undefined) ?? null;
        setNodePreview(out);
        const parentIds = flowEdges.filter((e) => e.target === nid).map((e) => e.source);
        if (parentIds.length === 1) {
          const upOut = (res?.node_outputs?.[parentIds[0]] as JsonObj | undefined) ?? null;
          setUpstreamPreview(upOut);
        } else {
          setUpstreamPreview(null);
        }
      } catch (e) {
        if (!cancelled) {
          setNodePreview(null);
          setUpstreamPreview(null);
        }
      }
    }
    void run(nodeId, wfId, edges);
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

  const validateFormulaPython = useCallback(async () => {
    setFormulaValidateMsg(null);
    if (!workflowId || !selectedNode || selectedNode.data.nodeType !== "formula") {
      setFormulaValidateMsg("Select a formula node.");
      return;
    }
    const cfg = selectedNode.data.configJson ?? {};
    const panel = inferFormulaPanel(cfg);
    const code =
      panel === "legacy"
        ? ""
        : panel === "visual"
          ? generatePythonFromRows(parseFormulaBuilderRows(cfg))
          : String((cfg as { python_code?: string }).python_code ?? "");
    if (panel === "legacy") {
      setFormulaValidateMsg("Literal map mode has no Python to validate — switch to Visual builder or Python mode.");
      return;
    }
    const shape = validatePythonFormulaShape(code);
    if (!shape.ok) {
      setFormulaValidateMsg(shape.error ?? "Invalid formula shape.");
      return;
    }
    const ids = upstreamSourceIds(nodes, edges, selectedNode.id).dataObjectIds;
    const dataObjectId = ids.find((x) => x && x.trim()) ?? "";
    if (!dataObjectId) {
      setFormulaValidateMsg(
        "Connect an Input node and choose a device. Saving the workflow is required before the server test sees graph changes.",
      );
      return;
    }
    setFormulaValidateBusy(true);
    try {
      const res = await wfApi.testWorkflow(workflowId, {
        data_object_id: dataObjectId,
        use_latest_observed_payload: true,
      });
      if (res?.status === "success" && !res.error) {
        setFormulaValidateMsg("OK — saved workflow test run succeeded (uses persisted graph).");
      } else {
        setFormulaValidateMsg(res?.error ?? `Status: ${res?.status ?? "unknown"}`);
      }
    } catch (e) {
      setFormulaValidateMsg(e instanceof Error ? e.message : "Test failed");
    } finally {
      setFormulaValidateBusy(false);
    }
  }, [workflowId, selectedNode, nodes, edges]);

  if (!workflowId) {
    return <PageShell>Missing id.</PageShell>;
  }

  const showIncomingPanel =
    selectedNode &&
    (selectedNode.data.nodeType === "input" ||
      selectedNode.data.nodeType === "static" ||
      PROCESSING_NODE_TYPES.has(selectedNode.data.nodeType));
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
    if (selectedNode.data.nodeType === "input" || selectedNode.data.nodeType === "static") {
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
    <PageShell className="workflow-editor-page workflow-editor-page--full">
      <AppToolbar variant="flat" className="workflow-editor__toolbar">
        <Link to="/workflow/list">← List</Link>
        <label className="app-field-row" style={{ marginBottom: 0, display: "inline-flex", flexDirection: "row", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={published}
            className="app-control"
            style={{ width: "14rem" }}
          />
        </label>
        <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
          {status}
          {published ? " · editing locked" : ""}
        </span>
        <AppButton variant="primary" disabled={published} onClick={() => void save()}>
          Save
        </AppButton>
        <AppButton variant="secondary" onClick={() => void validate()}>
          Validate
        </AppButton>
        <Link to={`/workflow/${workflowId}/test`} className={appButtonClassName("secondary")} style={{ textDecoration: "none", display: "inline-block" }}>
          Test
        </Link>
        <Link to={`/workflow/${workflowId}/live`} className={appButtonClassName("secondary")} style={{ textDecoration: "none", display: "inline-block" }}>
          Live
        </Link>
      </AppToolbar>
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
      <ReactFlowProvider>
        <WorkflowFlowCanvas
          published={published}
          publishedSources={publishedSources}
          staticSources={staticSources}
          setNodes={setNodes}
          themeLight={themeLight}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          setSel={setSel}
        />
      </ReactFlowProvider>
      <ConfigDrawer
        open={!!selectedNode}
        onClose={() => setSel(null)}
        title="Node configuration"
        subtitle={selectedNode ? `${selectedNode.data.nodeName} · ${selectedNode.data.nodeType}` : undefined}
        width={460}
      >
        {!selectedNode && <span style={{ color: "var(--color-text-muted)" }}>Select a node on the canvas</span>}
        {selectedNode && (
          <>
              <label className="app-field-row">
                Display name
                <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} className="app-control" disabled={published} />
              </label>
              {selectedNode.data.nodeType === "input" && (
                <>
                  <label className="app-field-row">
                    Device
                    <select
                      value={String((selectedNode.data.configJson as { data_object_id?: string }).data_object_id ?? "")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ data_object_id: e.target.value })}
                      className="app-control"
                    >
                      <option value="">— Select —</option>
                      {inputDeviceOptions.map((o) => (
                        <option key={o.deviceId} value={o.dataObjectId}>
                          {o.label}
                        </option>
                      ))}
                      {(() => {
                        const cur = String(
                          (selectedNode.data.configJson as { data_object_id?: string }).data_object_id ?? "",
                        );
                        const known = inputDeviceOptions.some((o) => o.dataObjectId === cur);
                        return cur && !known ? (
                          <option value={cur}>Saved binding (not in current site list)</option>
                        ) : null;
                      })()}
                    </select>
                  </label>
                  <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: "0 0 0.35rem", lineHeight: 1.4 }}>
                    Binds the published data object for that device. Incoming preview and test runs use the latest observed
                    payload when samples exist.
                  </p>
                  {availableFields.length > 0 ? (
                    <label className="app-field-row">
                      Available fields
                      <select className="app-control" disabled>
                        {availableFields.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              )}
              {selectedNode.data.nodeType === "static" && (
                <>
                  <label className="app-field-row">
                    Static ingestion
                    <select
                      value={String((selectedNode.data.configJson as { static_ingestion_id?: string }).static_ingestion_id ?? "")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ static_ingestion_id: e.target.value })}
                      className="app-control"
                    >
                      <option value="">— Select —</option>
                      {staticSources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: "0 0 0.35rem", lineHeight: 1.4 }}>
                    Choose a static source (site-wide or per-device from <strong>Manage device</strong> →{" "}
                    <strong>Static JSON</strong>). The workflow engine loads{" "}
                    <code style={{ fontSize: "0.7rem" }}>payload_json</code> for this node (no incoming edges).
                  </p>
                  {availableFields.length > 0 ? (
                    <label className="app-field-row">
                      Payload fields
                      <select className="app-control" disabled>
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
                  <label className="app-field-row">
                    Rule logic
                    <select
                      value={String((selectedNode.data.configJson as { logic?: string }).logic ?? "AND")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ logic: e.target.value })}
                      className="app-control"
                    >
                      <option value="AND">AND</option>
                      <option value="OR">OR</option>
                    </select>
                  </label>
                  {((selectedNode.data.configJson as { rules?: unknown }).rules as FilterRule[] | undefined)?.map((r, idx) => (
                    <div key={idx} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "0.35rem", marginBottom: "0.35rem" }}>
                      <div style={{ display: "grid", gap: "0.25rem" }}>
                        <select
                          className="app-control"
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
                          className="app-control"
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
                          className="app-control"
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
                    <AppButton
                      variant="secondary"
                      disabled={published}
                      onClick={() => patchSelectedConfig({ rules: [{ field: availableFields[0] ?? "", op: "eq", value: "" }] })}
                    >
                      Add first rule
                    </AppButton>
                  )}
                  {Array.isArray((selectedNode.data.configJson as { rules?: unknown }).rules) ? (
                    <AppButton
                      variant="secondary"
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
                    </AppButton>
                  ) : null}
                </>
              )}
              {selectedNode.data.nodeType === "join" && (
                <>
                  <label className="app-field-row">
                    Left input
                    <select
                      className="app-control"
                      value={String((selectedNode.data.configJson as { left_input?: string }).left_input ?? parentNodes[0]?.id ?? "")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ left_input: e.target.value })}
                    >
                      {parentNodes.map((p) => (
                        <option key={p.id} value={p.id}>{p.data.nodeName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="app-field-row">
                    Right input
                    <select
                      className="app-control"
                      value={String((selectedNode.data.configJson as { right_input?: string }).right_input ?? parentNodes[1]?.id ?? "")}
                      disabled={published}
                      onChange={(e) => patchSelectedConfig({ right_input: e.target.value })}
                    >
                      {parentNodes.map((p) => (
                        <option key={p.id} value={p.id}>{p.data.nodeName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="app-field-row">Left key<input className="app-control" value={String((selectedNode.data.configJson as { left_key?: string }).left_key ?? "")} onChange={(e) => patchSelectedConfig({ left_key: e.target.value })} disabled={published} /></label>
                  <label className="app-field-row">Right key<input className="app-control" value={String((selectedNode.data.configJson as { right_key?: string }).right_key ?? "")} onChange={(e) => patchSelectedConfig({ right_key: e.target.value })} disabled={published} /></label>
                  <label className="app-field-row">
                    Join type
                    <select className="app-control" value={String((selectedNode.data.configJson as { join_type?: string }).join_type ?? "inner")} onChange={(e) => patchSelectedConfig({ join_type: e.target.value })} disabled={published}>
                      <option value="inner">inner</option><option value="left">left</option><option value="right">right</option><option value="full">full</option>
                    </select>
                  </label>
                  <label className="app-field-row">
                    Output handling
                    <select className="app-control" value={String((selectedNode.data.configJson as { output_mode?: string }).output_mode ?? "prefix")} onChange={(e) => patchSelectedConfig({ output_mode: e.target.value })} disabled={published}>
                      <option value="prefix">Prefix fields</option><option value="retain">Retain names</option>
                    </select>
                  </label>
                </>
              )}
              {selectedNode.data.nodeType === "formula" && (
                <>
                  <label className="app-field-row">
                    Mode
                    <select
                      className="app-control"
                      value={inferFormulaPanel(selectedNode.data.configJson ?? {})}
                      onChange={(e) => {
                        const v = e.target.value as "visual" | "python" | "legacy";
                        if (v === "legacy") {
                          patchSelectedConfig({ formula_panel: "legacy", mode: "simple" });
                        } else if (v === "python") {
                          patchSelectedConfig({
                            formula_panel: "python",
                            mode: "python",
                            python_code:
                              String((selectedNode.data.configJson as { python_code?: string }).python_code ?? "").trim() ||
                              WORKFLOW_FORMULA_PYTHON_EXAMPLE,
                          });
                        } else {
                          const rows = parseFormulaBuilderRows(selectedNode.data.configJson ?? {});
                          patchSelectedConfig({
                            formula_panel: "visual",
                            mode: "python",
                            formula_builder_rows: rows,
                            python_code: generatePythonFromRows(rows),
                          });
                        }
                      }}
                      disabled={published}
                    >
                      <option value="visual">Visual formula builder (generates Python)</option>
                      <option value="python">Python (manual)</option>
                      <option value="legacy">Legacy literal map (JSON)</option>
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
                        Choose a device on an Input node and save the workflow, then use Test run or the incoming preview below. Fields appear after a successful workflow test.
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
                        The runner calls <code style={{ fontSize: "0.7rem" }}>transform(payload)</code> with one dict copied from the upstream node. Top-level keys usually come from the device&apos;s latest observed sample (or the published mirror); the test loader also adds{" "}
                        <code style={{ fontSize: "0.7rem" }}>_kpi</code> and <code style={{ fontSize: "0.7rem" }}>_health_status</code> when present.
                      </li>
                      <li>
                        Dotted paths in the list describe nesting: e.g. <code style={{ fontSize: "0.7rem" }}>a.b</code> means use{" "}
                        <code style={{ fontSize: "0.7rem" }}>{'payload["a"]["b"]'}</code> (or chained <code style={{ fontSize: "0.7rem" }}>.get()</code>) in Python — not one key named{" "}
                        <code style={{ fontSize: "0.7rem" }}>{'"a.b"'}</code>.
                      </li>
                      <li>
                        <strong>Legacy literal map:</strong> <code style={{ fontSize: "0.7rem" }}>set</code> merges literal values only (no expressions).
                      </li>
                      <li>
                        <strong>Python / visual:</strong> return a dict of new or updated top-level keys.
                      </li>
                    </ul>
                  </details>
                  {inferFormulaPanel(selectedNode.data.configJson ?? {}) === "visual" ? (
                    <WorkflowFormulaBuilderPanel
                      rows={parseFormulaBuilderRows(selectedNode.data.configJson ?? {})}
                      availableFields={availableFields}
                      disabled={published}
                      onChangeRows={(next) => {
                        patchSelectedConfig({
                          formula_builder_rows: next,
                          mode: "python",
                          formula_panel: "visual",
                          python_code: generatePythonFromRows(next),
                        });
                      }}
                      onGeneratedCode={(py) => {
                        patchSelectedConfig({ python_code: py, mode: "python", formula_panel: "visual" });
                      }}
                    />
                  ) : null}
                  {inferFormulaPanel(selectedNode.data.configJson ?? {}) === "python" ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--color-text)" }}>Python `transform(payload)` (sandboxed)</span>
                        <details style={{ fontSize: "0.72rem", maxWidth: "100%" }}>
                          <summary style={{ cursor: "pointer", color: "var(--color-accent)", fontWeight: 600 }}>Example</summary>
                          <pre
                            style={{
                              margin: "0.35rem 0 0",
                              padding: "0.5rem",
                              borderRadius: "var(--radius)",
                              border: "1px solid var(--color-border)",
                              background: "var(--color-bg)",
                              fontSize: "0.68rem",
                              overflow: "auto",
                              maxHeight: "11rem",
                              lineHeight: 1.35,
                            }}
                          >
                            {WORKFLOW_FORMULA_PYTHON_EXAMPLE}
                          </pre>
                        </details>
                      </div>
                      <textarea
                        className="app-control app-control--mono"
                        style={{ width: "100%" }}
                        rows={10}
                        value={String((selectedNode.data.configJson as { python_code?: string }).python_code ?? "def transform(payload):\n    return {}")}
                        onChange={(e) => patchSelectedConfig({ python_code: e.target.value, mode: "python", formula_panel: "python" })}
                        disabled={published}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginTop: "0.35rem" }}>
                        <AppButton variant="secondary" disabled={published || formulaValidateBusy} onClick={() => void validateFormulaPython()}>
                          {formulaValidateBusy ? "Validating…" : "Validate formula"}
                        </AppButton>
                        <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
                          Checks <code>def transform(payload)</code>, then runs a server test (saved workflow + published sample).
                        </span>
                      </div>
                      {formulaValidateMsg ? (
                        <div
                          className="ops-strip ops-strip--warn"
                          style={{
                            marginTop: "0.45rem",
                            fontSize: "0.78rem",
                            ...(formulaValidateMsg.startsWith("OK")
                              ? {
                                  color: "var(--page-status-success-fg)",
                                  background: "var(--page-status-success-bg)",
                                  borderColor: "var(--page-status-success-border)",
                                }
                              : {}),
                          }}
                        >
                          {formulaValidateMsg}
                        </div>
                      ) : null}
                      <label className="app-field-row" style={{ marginTop: "0.5rem" }}>
                        Timeout ms
                        <input className="app-control" type="number" value={Number((selectedNode.data.configJson as { timeout_ms?: number }).timeout_ms ?? 300)} onChange={(e) => patchSelectedConfig({ timeout_ms: Number(e.target.value || 300) })} disabled={published} />
                      </label>
                    </>
                  ) : null}
                  {inferFormulaPanel(selectedNode.data.configJson ?? {}) === "legacy" ? (
                    <label className="app-field-row">
                      Literal map (JSON object)
                      <textarea
                        className="app-control app-control--mono"
                        style={{ width: "100%" }}
                        rows={5}
                        value={JSON.stringify((selectedNode.data.configJson as { set?: JsonObj }).set ?? {}, null, 2)}
                        onChange={(e) => {
                          try {
                            patchSelectedConfig({ set: JSON.parse(e.target.value), mode: "simple", formula_panel: "legacy" });
                          } catch {
                            setErr("Simple formula set must be valid JSON object");
                          }
                        }}
                        disabled={published}
                      />
                    </label>
                  ) : null}
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
                  <label className="app-field-row">
                    Result object name
                    <input className="app-control" value={terminateName} disabled={published} onChange={(e) => patchSelectedConfig({ terminate_name: e.target.value })} />
                  </label>
                  {terminateNameDup ? <PageStatus variant="error">Terminate name must be unique in this workflow.</PageStatus> : null}
                </>
              )}
              <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
                <AppButton variant="primary" disabled={published} onClick={applySelectionEdits}>
                  Apply node name
                </AppButton>
              </div>
              <details style={{ marginTop: "0.35rem", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--color-text)" }}>
                  Expert: edit raw config JSON
                </summary>
                <label className="app-field-row" style={{ marginTop: "0.5rem" }}>
                  config_json
                  <textarea
                    value={cfgText}
                    onChange={(e) => {
                      setCfgText(e.target.value);
                      setAdvancedMode(true);
                    }}
                    disabled={published}
                    rows={8}
                    className="app-control app-control--mono"
                    style={{ width: "100%" }}
                  />
                </label>
                <AppButton variant="secondary" disabled={published} onClick={applySelectionEdits}>
                  Apply JSON
                </AppButton>
              </details>
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
      </ConfigDrawer>
    </PageShell>
  );
}

