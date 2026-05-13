import type { DeviceImportCommitRow } from "@/api/devices";

/** RFC 4180–style CSV rows (handles quoted fields and doubled quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

function normHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, "_");
}

export type DeviceCsvImportRow = {
  /** 1-based line number in the file (including header as line 1; first data row is line 2). */
  line: number;
  name: string;
  site_id: string;
  description: string;
  icon: string;
  is_active: boolean;
  polling_enabled: boolean;
  expected_interval_seconds: number | null;
  late_threshold_seconds: number | null;
  offline_threshold_seconds: number | null;
  firmware_version: string;
  firmware_channel: string;
  ota_supported: boolean;
  rollback_supported: boolean;
  device_version: string;
  version_status: string;
};

export type DeviceCsvParseRowError = { line: number; message: string };

function resolveSiteId(
  sites: { id: string; name: string }[],
  siteIdRaw: string,
  siteNameRaw: string,
): string | null {
  const sid = siteIdRaw.trim();
  if (sid) {
    if (sites.some((s) => s.id === sid)) return sid;
    return null;
  }
  const name = siteNameRaw.trim();
  if (!name) return null;
  const exact = sites.find((s) => s.name === name);
  if (exact) return exact.id;
  const lower = name.toLowerCase();
  const ci = sites.find((s) => s.name.toLowerCase() === lower);
  return ci?.id ?? null;
}

function parseOptionalBool(raw: string): boolean | null {
  const x = raw.trim().toLowerCase();
  if (!x) return null;
  if (["true", "yes", "y", "1", "on"].includes(x)) return true;
  if (["false", "no", "n", "0", "off"].includes(x)) return false;
  return null;
}

function parseOptionalInt(raw: string): number | "invalid" | null {
  const x = raw.trim();
  if (!x) return null;
  const n = Number.parseInt(x, 10);
  if (!Number.isFinite(n)) return "invalid";
  return n;
}

/**
 * Parse device import CSV. Required: `name` and either `site` or `site_id`.
 * Optional columns match device registration / profile: icon, is_active, polling_enabled,
 * expected_interval_seconds, late_threshold_seconds, offline_threshold_seconds,
 * firmware_version, firmware_channel, ota_supported, rollback_supported, device_version, version_status.
 * Export snapshot columns (protocol, activation, …) are ignored.
 */
export function parseDeviceImportCsv(
  text: string,
  sites: { id: string; name: string }[],
): { devices: DeviceCsvImportRow[]; errors: string[]; rowParseErrors: DeviceCsvParseRowError[] } {
  const errors: string[] = [];
  const rowParseErrors: DeviceCsvParseRowError[] = [];
  const pushRowErr = (line: number, message: string) => {
    rowParseErrors.push({ line, message });
    errors.push(`Line ${line}: ${message}`);
  };
  const trimmed = text.trim();
  if (!trimmed) {
    errors.push("File is empty.");
    return { devices: [], errors, rowParseErrors };
  }
  const matrix = parseCsv(trimmed);
  if (matrix.length < 2) {
    errors.push("CSV must include a header row and at least one data row.");
    return { devices: [], errors, rowParseErrors };
  }
  const headerCells = matrix[0]!.map((h) => normHeader(h));
  const findIdx = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = headerCells.indexOf(a);
      if (i >= 0) return i;
    }
    return -1;
  };
  const nameIdx = findIdx(["name", "device_name"]);
  const siteIdx = findIdx(["site", "site_name"]);
  const siteIdIdx = findIdx(["site_id"]);
  const descIdx = findIdx(["description", "desc"]);
  const iconIdx = findIdx(["icon"]);
  const activeIdx = findIdx(["is_active", "active"]);
  const pollIdx = findIdx(["polling_enabled", "polling"]);
  const expIdx = findIdx(["expected_interval_seconds", "expected_interval", "ingest_interval"]);
  const lateIdx = findIdx(["late_threshold_seconds", "late_threshold", "late"]);
  const offIdx = findIdx(["offline_threshold_seconds", "offline_threshold", "offline"]);
  const fwVerIdx = findIdx(["firmware_version", "firmware"]);
  const fwChIdx = findIdx(["firmware_channel", "channel"]);
  const otaIdx = findIdx(["ota_supported", "ota"]);
  const rbIdx = findIdx(["rollback_supported", "rollback"]);
  const devVerIdx = findIdx(["device_version"]);
  const verStIdx = findIdx(["version_status"]);

  if (nameIdx < 0) errors.push("Missing required column: name (or device_name).");
  if (siteIdx < 0 && siteIdIdx < 0) errors.push("Missing required column: site (or site_name) and/or site_id.");

  if (errors.length) return { devices: [], errors, rowParseErrors };

  const devices: DeviceCsvImportRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = r + 1;
    const row = matrix[r] ?? [];
    const name = (row[nameIdx] ?? "").trim();
    const siteIdRaw = siteIdIdx >= 0 ? (row[siteIdIdx] ?? "").trim() : "";
    const siteNameRaw = siteIdx >= 0 ? (row[siteIdx] ?? "").trim() : "";
    const descRaw = descIdx >= 0 ? (row[descIdx] ?? "").trim() : "";
    const iconRaw = iconIdx >= 0 ? (row[iconIdx] ?? "").trim() : "";
    const activeRaw = activeIdx >= 0 ? (row[activeIdx] ?? "").trim() : "";
    const pollRaw = pollIdx >= 0 ? (row[pollIdx] ?? "").trim() : "";
    const expRaw = expIdx >= 0 ? (row[expIdx] ?? "").trim() : "";
    const lateRaw = lateIdx >= 0 ? (row[lateIdx] ?? "").trim() : "";
    const offRaw = offIdx >= 0 ? (row[offIdx] ?? "").trim() : "";
    const fwVerRaw = fwVerIdx >= 0 ? (row[fwVerIdx] ?? "").trim() : "";
    const fwChRaw = fwChIdx >= 0 ? (row[fwChIdx] ?? "").trim() : "";
    const otaRaw = otaIdx >= 0 ? (row[otaIdx] ?? "").trim() : "";
    const rbRaw = rbIdx >= 0 ? (row[rbIdx] ?? "").trim() : "";
    const devVerRaw = devVerIdx >= 0 ? (row[devVerIdx] ?? "").trim() : "";
    const verStRaw = verStIdx >= 0 ? (row[verStIdx] ?? "").trim() : "";

    if (!name && !siteIdRaw && !siteNameRaw && !descRaw && !iconRaw) continue;

    if (!name) {
      pushRowErr(line, "missing device name.");
      continue;
    }
    const site_id = resolveSiteId(sites, siteIdRaw, siteNameRaw);
    if (!site_id) {
      if (siteIdRaw) pushRowErr(line, `unknown site_id "${siteIdRaw}".`);
      else if (siteNameRaw) pushRowErr(line, `unknown site "${siteNameRaw}".`);
      else pushRowErr(line, "missing site (name or site_id).");
      continue;
    }

    const isAct = parseOptionalBool(activeRaw);
    if (activeRaw.trim() && isAct === null) {
      pushRowErr(line, `invalid is_active "${activeRaw.trim()}" (use true/false, yes/no, 1/0).`);
      continue;
    }
    const pollEn = parseOptionalBool(pollRaw);
    if (pollRaw.trim() && pollEn === null) {
      pushRowErr(line, `invalid polling_enabled "${pollRaw.trim()}" (use true/false, yes/no, 1/0).`);
      continue;
    }
    const otaB = parseOptionalBool(otaRaw);
    if (otaRaw.trim() && otaB === null) {
      pushRowErr(line, `invalid ota_supported "${otaRaw.trim()}" (use true/false, yes/no, 1/0).`);
      continue;
    }
    const rbB = parseOptionalBool(rbRaw);
    if (rbRaw.trim() && rbB === null) {
      pushRowErr(line, `invalid rollback_supported "${rbRaw.trim()}" (use true/false, yes/no, 1/0).`);
      continue;
    }

    let expected_interval_seconds: number | null = null;
    if (expRaw.trim()) {
      const p = parseOptionalInt(expRaw);
      if (p === "invalid") {
        pushRowErr(line, `invalid expected_interval_seconds "${expRaw.trim()}".`);
        continue;
      }
      expected_interval_seconds = p;
    }
    let late_threshold_seconds: number | null = null;
    if (lateRaw.trim()) {
      const p = parseOptionalInt(lateRaw);
      if (p === "invalid") {
        pushRowErr(line, `invalid late_threshold_seconds "${lateRaw.trim()}".`);
        continue;
      }
      late_threshold_seconds = p;
    }
    let offline_threshold_seconds: number | null = null;
    if (offRaw.trim()) {
      const p = parseOptionalInt(offRaw);
      if (p === "invalid") {
        pushRowErr(line, `invalid offline_threshold_seconds "${offRaw.trim()}".`);
        continue;
      }
      offline_threshold_seconds = p;
    }
    if (
      late_threshold_seconds != null &&
      offline_threshold_seconds != null &&
      offline_threshold_seconds < late_threshold_seconds
    ) {
      pushRowErr(line, "offline_threshold_seconds must be >= late_threshold_seconds.");
      continue;
    }

    devices.push({
      line,
      name,
      site_id,
      description: descRaw,
      icon: iconRaw,
      is_active: isAct ?? true,
      polling_enabled: pollEn ?? true,
      expected_interval_seconds,
      late_threshold_seconds,
      offline_threshold_seconds,
      firmware_version: fwVerRaw,
      firmware_channel: fwChRaw.trim().toLowerCase(),
      ota_supported: otaB ?? false,
      rollback_supported: rbB ?? false,
      device_version: devVerRaw,
      version_status: verStRaw.trim().toLowerCase().replace(/\s+/g, "_"),
    });
  }

  if (!devices.length && !errors.length) errors.push("No device rows found after the header.");
  return { devices, errors, rowParseErrors };
}

/** Build API import row from editable grid state (nulls omit optional numeric/string overrides). */
export function deviceCsvRowToImportApiRow(row: DeviceCsvImportRow): DeviceImportCommitRow {
  return {
    line: row.line,
    name: row.name.trim(),
    site_id: row.site_id,
    description: row.description.trim() ? row.description.trim() : null,
    icon: row.icon.trim() ? row.icon.trim() : null,
    is_active: row.is_active,
    polling_enabled: row.polling_enabled,
    expected_interval_seconds: row.expected_interval_seconds,
    late_threshold_seconds: row.late_threshold_seconds,
    offline_threshold_seconds: row.offline_threshold_seconds,
    firmware_version: row.firmware_version.trim() ? row.firmware_version.trim() : null,
    firmware_channel: row.firmware_channel.trim() ? row.firmware_channel.trim() : null,
    ota_supported: row.ota_supported,
    rollback_supported: row.rollback_supported,
    device_version: row.device_version.trim() ? row.device_version.trim() : null,
    version_status: row.version_status.trim() ? row.version_status.trim() : null,
  };
}
