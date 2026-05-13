/** Lowercase words that stay lowercase after the first word (title-style status labels). */
const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "nor",
  "not",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "vs",
  "via",
  "with",
]);

/**
 * Title-style label for status chips: first word capitalized; later words capitalized unless small-word.
 * Examples: `active` → "Active", `waiting_for_first_payload` → "Waiting for First Payload", `not_linked` → "Not Linked".
 */
export function formatStatusDisplayLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  const t = String(raw).trim();
  if (!t || t === "—") return t;

  const normalized = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(" ").filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      if (!w.length) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}
