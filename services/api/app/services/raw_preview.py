"""Bounded read of raw MinIO objects for API preview (no full-archive streaming to clients)."""

from __future__ import annotations

import base64

from minio.error import S3Error

from app.core.config import settings
from app.services import minio_raw


def read_raw_slice(*, storage_key: str, offset: int, max_bytes: int) -> tuple[bytes, int | None]:
    """
    Read at most max_bytes starting at offset.
    Returns (data, total_object_size or None if unknown).
    """
    client = minio_raw.raw_archive_client()
    bucket = settings.minio_bucket_raw
    total: int | None = None
    try:
        st = client.stat_object(bucket, storage_key)
        total = int(st.size)
    except S3Error:
        total = None

    end = offset + max_bytes - 1
    if total is not None and offset >= total:
        return b"", total

    try:
        obj = client.get_object(bucket, storage_key, offset=offset, length=max_bytes)
    except TypeError:
        end = offset + max_bytes - 1
        obj = client.get_object(
            bucket,
            storage_key,
            request_headers={"Range": f"bytes={offset}-{end}"},
        )
    try:
        data = obj.read()
    finally:
        try:
            obj.close()
        except Exception:
            pass
        try:
            obj.release_conn()
        except Exception:
            pass

    return data, total


def build_preview_payload(
    *,
    content_type: str | None,
    data: bytes,
) -> tuple[str, str | None, str | None]:
    """
    Returns (encoding, text_or_none, base64_or_none).
    encoding is 'utf8' or 'base64'.
    """
    ct = (content_type or "").lower()
    text_like = ct.startswith("text/") or "json" in ct or ct in ("application/xml", "application/yaml")
    if text_like:
        try:
            txt = data.decode("utf-8")
            return "utf8", txt, None
        except UnicodeDecodeError:
            pass
    if ct in ("application/octet-stream", "") or not ct:
        try:
            txt = data.decode("utf-8")
        except UnicodeDecodeError:
            pass
        else:
            if not txt.strip():
                return "utf8", txt, None
            s = txt.lstrip()
            if s and (s[0] == "{" or s[0] == "["):
                return "utf8", txt, None
    b64 = base64.b64encode(data).decode("ascii")
    return "base64", None, b64
