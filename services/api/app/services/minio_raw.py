"""MinIO client and object IO for raw archive (no secrets in logs)."""

from __future__ import annotations

import io
from typing import BinaryIO

from minio import Minio
from minio.error import S3Error

from app.core.config import settings


def _parse_host_port(endpoint: str) -> tuple[str, int]:
    ep = endpoint.strip()
    for prefix in ("https://", "http://"):
        if ep.startswith(prefix):
            ep = ep[len(prefix) :]
    if ":" in ep:
        host, _, port_s = ep.rpartition(":")
        return host, int(port_s)
    return ep, 9000


def raw_archive_client() -> Minio:
    host, port = _parse_host_port(settings.minio_endpoint)
    return Minio(
        f"{host}:{port}",
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_use_ssl,
    )


def put_raw_object(
    storage_key: str,
    data: bytes | BinaryIO,
    length: int,
    content_type: str | None,
) -> None:
    client = raw_archive_client()
    bucket = settings.minio_bucket_raw
    body: BinaryIO = io.BytesIO(data) if isinstance(data, bytes) else data
    client.put_object(
        bucket,
        storage_key,
        body,
        length,
        content_type=content_type or "application/octet-stream",
    )


def remove_raw_object(storage_key: str) -> None:
    client = raw_archive_client()
    bucket = settings.minio_bucket_raw
    client.remove_object(bucket, storage_key)


def stat_raw_object(storage_key: str) -> tuple[bool, int | None]:
    """Return (exists, size)."""
    client = raw_archive_client()
    bucket = settings.minio_bucket_raw
    try:
        s = client.stat_object(bucket, storage_key)
        return True, int(s.size)
    except S3Error as e:
        code = getattr(e, "code", "") or ""
        if code in ("NoSuchKey", "NoSuchBucket"):
            return False, None
        raise


def read_raw_object_bytes(storage_key: str) -> bytes:
    client = raw_archive_client()
    bucket = settings.minio_bucket_raw
    obj = client.get_object(bucket, storage_key)
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
