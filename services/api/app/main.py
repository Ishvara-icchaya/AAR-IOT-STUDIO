import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.services.alert_service import AlertForbidden
from app.services.published_service_service import PublishedServiceForbidden
from app.core.kafka_topics import ensure_platform_topics
from app.core.logging_config import configure_logging
from app.core.mask import redact_database_url
from app.middleware.debug_http import DebugHttpMiddleware

configure_logging(
    settings.aar_log_level or settings.log_level,
    json_format=settings.aar_log_json,
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.debug("lifespan: startup")
    from app.core.pipeline_log import emit as pipeline_emit
    from app.core.seed import ensure_bootstrap_admin
    from app.db.session import SessionLocal

    pipeline_emit(
        log,
        component="api",
        action="db.metadata.connect",
        status="info",
        database_url=redact_database_url(settings.database_url),
    )
    pipeline_emit(
        log,
        component="api",
        action="db.timescale.connect",
        status="info",
        database_url=redact_database_url(settings.timescale_database_url),
    )

    db = SessionLocal()
    try:
        ensure_bootstrap_admin(db)
    except Exception:
        log.exception("Bootstrap seed failed")
        db.rollback()
    finally:
        db.close()

    pipeline_emit(
        log,
        component="api",
        action="migrations",
        status="ok",
        detail="alembic ran in container entrypoint before uvicorn",
    )

    try:
        ensure_platform_topics(settings.kafka_bootstrap_servers)
        log.info("Kafka platform topics ensured at %s", settings.kafka_bootstrap_servers)
    except Exception as e:
        log.warning("Kafka topic ensure skipped or failed: %s", e)

    pipeline_emit(
        log,
        component="api",
        action="minio.config",
        status="info",
        endpoint=settings.minio_endpoint,
        bucket=settings.minio_bucket_raw,
    )

    log.debug("lifespan: ready")
    yield
    from app.services.kafka_raw_publish import shutdown_producer

    shutdown_producer()
    log.debug("lifespan: shutdown")


app = FastAPI(
    title="AAR-IoT-Studio API",
    version="8.0.0",
    lifespan=lifespan,
)
app.state.settings = settings

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
# DebugHttp inner, CORS outer so Allow-Origin is still applied to many error paths.
app.add_middleware(DebugHttpMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["http://localhost:8888"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")
log.debug("FastAPI routes mounted under /api/v1")


@app.exception_handler(PublishedServiceForbidden)
async def _published_service_forbidden(_: Request, __: PublishedServiceForbidden) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": "Site not permitted for this published service"})


@app.exception_handler(AlertForbidden)
async def _alert_forbidden(_: Request, __: AlertForbidden) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": "Site not permitted for this alert"})


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi

    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
    )
    openapi_schema.setdefault("components", {}).setdefault("securitySchemes", {})["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


@app.get("/health")
def health():
    log.debug("health check")
    return {"status": "ok", "service": "aar-api"}
