"""Avoid leaking secrets in worker logs (headers, bearer tokens, URL queries)."""

from __future__ import annotations

from urllib.parse import urlparse, urlunparse


def redact_headers_for_log(headers: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        lk = k.lower()
        if lk in ("authorization", "proxy-authorization", "cookie", "x-api-key"):
            out[k] = "***REDACTED***"
        elif "token" in lk or "secret" in lk or lk.endswith("-key"):
            out[k] = "***REDACTED***"
        else:
            out[k] = v
    return out


def safe_url_for_log(url: str) -> str:
    """Scheme + host + port + path; strips query and fragment."""
    try:
        u = urlparse(url)
        clean = urlunparse((u.scheme, u.netloc, u.path or "", "", "", ""))
        return clean or "(invalid-url)"
    except Exception:
        return "(invalid-url)"
