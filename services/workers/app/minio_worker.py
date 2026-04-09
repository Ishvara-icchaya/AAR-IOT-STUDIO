"""MinIO reads/writes for workers (mirrors API raw bucket layout)."""

from __future__ import annotations

import io
import os

from minio import Minio


def _client() -> Minio:
    ep = os.environ.get("MINIO_ENDPOINT", "localhost:9000").strip()
    for prefix in ("https://", "http://"):
        if ep.startswith(prefix):
            ep = ep[len(prefix) :]
    secure = os.environ.get("MINIO_USE_SSL", "false").lower() in ("1", "true", "yes")
    if ":" in ep:
        host, _, ps = ep.rpartition(":")
        port = int(ps)
    else:
        host, port = ep, 9000
    return Minio(
        f"{host}:{port}",
        access_key=os.environ.get("MINIO_ACCESS_KEY", "minio"),
        secret_key=os.environ.get("MINIO_SECRET_KEY", "minio"),
        secure=secure,
    )


def put_raw_object_bytes(*, bucket: str, key: str, data: bytes, content_type: str | None) -> None:
    c = _client()
    ct = content_type or "application/octet-stream"
    c.put_object(bucket, key, io.BytesIO(data), len(data), content_type=ct)


def remove_raw_object(*, bucket: str, key: str) -> None:
    c = _client()
    c.remove_object(bucket, key)


def read_object_slice(*, bucket: str, key: str, offset: int, length: int) -> bytes:
    c = _client()
    try:
        obj = c.get_object(bucket, key, offset=offset, length=length)
    except TypeError:
        end = offset + length - 1
        obj = c.get_object(bucket, key, request_headers={"Range": f"bytes={offset}-{end}"})
    try:
        return obj.read()
    finally:
        try:
            obj.close()
        except Exception:
            pass
        try:
            obj.release_conn()
        except Exception:
            pass
