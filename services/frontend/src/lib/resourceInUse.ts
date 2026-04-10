import type { DependencyItem, ResourceInUseDetail } from "@/types/integrity";

/** FastAPI wraps `HTTPException(detail=...)` as `{ detail: ... }` in JSON. */
export function parseResourceInUseDetail(body: unknown): ResourceInUseDetail | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const raw = root.detail !== undefined ? root.detail : body;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.error !== "resource_in_use") return null;
  const deps = d.dependencies;
  const list: DependencyItem[] = Array.isArray(deps)
    ? (deps as DependencyItem[]).filter(
        (x) => x && typeof x === "object" && typeof (x as DependencyItem).entity_type === "string",
      )
    : [];
  return {
    error: "resource_in_use",
    message: typeof d.message === "string" ? d.message : "This resource is in use",
    dependencies: list,
    deactivate_url: d.deactivate_url == null ? null : String(d.deactivate_url),
    reactivate_url: d.reactivate_url == null ? null : String(d.reactivate_url),
    archive_url: d.archive_url == null ? null : String(d.archive_url),
  };
}
