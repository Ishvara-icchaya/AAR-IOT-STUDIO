from urllib.parse import urlparse, urlunparse


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
        return f"{u.scheme}://{netloc}{u.path or ''}"
    except Exception:
        return "***"
