import type { Scrubber2Model } from "@/types/scrubber2Model";

/** JSON paths for fields tagged with the `identity` role in Scrubber Studio semantics. */
export function primaryKeyPathsFromScrubberSemantics(model: Scrubber2Model): string[] {
  const paths: string[] = [];
  for (const row of model.fieldSemantics ?? []) {
    const p = typeof row.path === "string" ? row.path.trim() : "";
    if (!p) continue;
    if (Array.isArray(row.roles) && row.roles.includes("identity")) {
      paths.push(p);
    }
  }
  return paths;
}

/** JSON paths for fields tagged with the `display` role (device label in v2). */
export function deviceLabelPathsFromScrubberSemantics(model: Scrubber2Model): string[] {
  const paths: string[] = [];
  for (const row of model.fieldSemantics ?? []) {
    const p = typeof row.path === "string" ? row.path.trim() : "";
    if (!p) continue;
    if (Array.isArray(row.roles) && row.roles.includes("display")) {
      paths.push(p);
    }
  }
  return paths;
}
