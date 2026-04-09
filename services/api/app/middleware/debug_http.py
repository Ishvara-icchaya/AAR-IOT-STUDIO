import logging
import os
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.mask import mask_query_string
from app.core.pipeline_log import emit as pipeline_emit
from app.core.request_context import clear, set_trace_id

log = logging.getLogger("aar.http")


def _trace_pipeline(request: Request) -> bool:
    settings = getattr(request.app.state, "settings", None)
    if settings and getattr(settings, "aar_trace_pipeline", False):
        return True
    return os.environ.get("AAR_TRACE_PIPELINE", "").lower() in ("1", "true", "yes")


class DebugHttpMiddleware(BaseHTTPMiddleware):
    """Trace id propagation, request context, and structured HTTP checkpoints (no bodies / secrets)."""

    async def dispatch(self, request: Request, call_next):
        hdrs = request.headers
        trace_id = hdrs.get("x-trace-id") or hdrs.get("x-request-id") or str(uuid.uuid4())
        set_trace_id(trace_id)

        path = request.url.path
        qs = mask_query_string(str(request.url.query))
        method = request.method
        trace_pl = _trace_pipeline(request)
        debug_on = log.isEnabledFor(logging.DEBUG)

        if debug_on:
            log.debug("--> %s %s%s", method, path, f"?{qs}" if qs else "")

        t0 = time.perf_counter()
        try:
            try:
                response = await call_next(request)
            except Exception:
                duration_ms = (time.perf_counter() - t0) * 1000
                if debug_on:
                    log.debug(
                        "!!! %s %s failed after %.3fs",
                        method,
                        path,
                        duration_ms / 1000,
                        exc_info=True,
                    )
                if trace_pl and path.startswith("/api/v1"):
                    pipeline_emit(
                        log,
                        component="api.http",
                        action="request",
                        status="error",
                        duration_ms=duration_ms,
                        http_method=method,
                        http_path=path,
                        query_present=bool(qs),
                    )
                raise

            duration_ms = (time.perf_counter() - t0) * 1000
            response.headers["X-Trace-Id"] = trace_id

            if debug_on:
                log.debug(
                    "<-- %s %s -> %s in %.3fs",
                    method,
                    path,
                    response.status_code,
                    duration_ms / 1000,
                )

            if trace_pl and path.startswith("/api/v1"):
                pipeline_emit(
                    log,
                    component="api.http",
                    action="request",
                    status="ok",
                    duration_ms=duration_ms,
                    http_method=method,
                    http_path=path,
                    http_status=response.status_code,
                    query_present=bool(qs),
                )

            return response
        finally:
            clear()
