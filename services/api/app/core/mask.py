"""Redact secrets and sensitive values from logs (passwords, tokens, URLs, payloads)."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse, urlunparse

_SENSITIVE_KEY_RE = re.compile(
    r"(password|passwd|pwd|secret|token|authorization|apikey|api_key|"
    r"access_key|secret_key|credential|bearer|jwt|cookie|connection)",
    re.I,
)


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return email
    local, _, domain = email.partition("@")
    if not local:
        return f"***@{domain}"
    return f"{local[0]}***@{domain}"


def redact_database_url(url: str) -> str:
    """Keep scheme+host+db name; strip credentials."""
    try:
        u = urlparse(url.replace("postgresql+psycopg2://", "postgresql://"))
        host = u.hostname or ""
        port = f":{u.port}" if u.port else ""
        path = u.path or ""
        return f"{u.scheme}://{host}{port}{path}"
    except Exception:
        return "***"


def redact_url(url: str) -> str:
    try:
        u = urlparse(url)
        user = "***" if u.username else ""
        passwd = ""
        if u.password:
            passwd = ":***"
        netloc = u.hostname or ""
        if u.port:
            netloc = f"{netloc}:{u.port}"
        if user:
            netloc = f"{user}{passwd}@{netloc}"
        return urlunparse((u.scheme, netloc, u.path, u.params, "", u.fragment))
    except Exception:
        return "***"


def _mask_scalar(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, str):
        if len(val) > 120:
            return f"<redacted len={len(val)}>"
        return val
    return val


def mask_mapping(obj: dict[str, Any], depth: int = 0) -> dict[str, Any]:
    if depth > 6:
        return {"_truncated": True}
    out: dict[str, Any] = {}
    for k, v in obj.items():
        if _SENSITIVE_KEY_RE.search(k):
            out[k] = "***"
            continue
        if isinstance(v, dict):
            out[k] = mask_mapping(v, depth + 1)
        elif isinstance(v, list) and depth < 4:
            out[k] = [
                mask_mapping(x, depth + 1) if isinstance(x, dict) else _mask_scalar(x) for x in v[:50]
            ]
        else:
            out[k] = _mask_scalar(v)
    return out


def mask_query_string(qs: str) -> str:
    if not qs:
        return ""
    parts: list[str] = []
    for pair in qs.split("&"):
        if "=" not in pair:
            parts.append(pair)
            continue
        k, _, _v = pair.partition("=")
        if _SENSITIVE_KEY_RE.search(k):
            parts.append(f"{k}=***")
        else:
            parts.append(pair)
    return "&".join(parts)
