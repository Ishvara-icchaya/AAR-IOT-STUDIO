ALLOWED = ("info", "warning", "critical")


def normalize_severity(raw: str | None) -> str:
    if not raw:
        return "info"
    x = str(raw).strip().lower()
    if x in ALLOWED:
        return x
    if x in ("fatal", "severe", "emergency", "high", "error", "red", "failed", "failure"):
        return "critical"
    if x in ("medium", "yellow", "warn", "degraded"):
        return "warning"
    if x in ("low", "green", "blue", "ok", "success", "debug", "notice"):
        return "info"
    return "warning"
