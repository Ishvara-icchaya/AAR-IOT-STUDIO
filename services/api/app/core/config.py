import uuid

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    aar_debug: bool = Field(default=False, validation_alias="AAR_DEBUG")
    aar_trace_pipeline: bool = Field(default=False, validation_alias="AAR_TRACE_PIPELINE")
    aar_log_json: bool = Field(default=False, validation_alias="AAR_LOG_JSON")
    aar_log_level: str | None = Field(default=None, validation_alias="AAR_LOG_LEVEL")

    # Host port matches docker-compose.yml (postgres service maps 5434 -> container 5432).
    database_url: str = "postgresql+psycopg2://aar:aar_dev_change_me@127.0.0.1:5434/aar_metadata"
    timescale_database_url: str = (
        "postgresql+psycopg2://aar:aar_dev_change_me@localhost:5433/aar_timeseries"
    )
    redis_url: str = "redis://localhost:6379/0"
    trend_metric_allowlist: str = Field(
        default="",
        validation_alias="TREND_METRIC_ALLOWLIST",
        description="Comma/whitespace-separated metric keys allowed in GET /trends/window and map trend_context; empty = no filter (sites may override).",
    )
    kafka_bootstrap_servers: str = "localhost:9092"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minio"
    minio_secret_key: str = "minio_dev_change_me"
    minio_bucket_raw: str = "aar-raw"
    minio_use_ssl: bool = Field(default=False, validation_alias="MINIO_USE_SSL")
    raw_ingest_max_bytes: int = Field(
        default=32 * 1024 * 1024,
        validation_alias="RAW_INGEST_MAX_BYTES",
    )
    raw_preview_max_bytes: int = Field(
        default=512 * 1024,
        validation_alias="RAW_PREVIEW_MAX_BYTES",
    )
    kafka_publish_raw_ingest: bool = Field(
        default=True,
        validation_alias="KAFKA_PUBLISH_RAW_INGEST",
    )
    kafka_raw_ingest_topic: str = Field(
        default="raw.ingest",
        validation_alias="KAFKA_RAW_INGEST_TOPIC",
    )
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    jwt_secret_key: str = Field(
        default="change-me-in-production-use-long-random-string",
        validation_alias="JWT_SECRET_KEY",
    )
    jwt_algorithm: str = Field(default="HS256", validation_alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(
        default=60 * 24, validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES"
    )
    bootstrap_admin_email: str = Field(
        default="admin@example.com", validation_alias="BOOTSTRAP_ADMIN_EMAIL"
    )
    bootstrap_admin_password: str = Field(
        default="admin123", validation_alias="BOOTSTRAP_ADMIN_PASSWORD"
    )

    monitoring_deep_cooldown_seconds: int = Field(
        default=600,
        validation_alias="MONITORING_DEEP_COOLDOWN_SECONDS",
    )
    monitoring_queue_lag_threshold: int = Field(
        default=10_000,
        validation_alias="MONITORING_QUEUE_LAG_THRESHOLD",
    )
    ollama_base_url: str = Field(
        default="http://localhost:11434",
        validation_alias="OLLAMA_BASE_URL",
    )
    ollama_model: str = Field(default="llama3", validation_alias="OLLAMA_MODEL")
    # Per-request hints to Ollama (/api/chat): extend GPU residency and cap decode cost (see ai_health_service.call_ollama_chat).
    ollama_request_keep_alive: str = Field(
        default="30m",
        validation_alias="OLLAMA_REQUEST_KEEP_ALIVE",
        description='Go-style duration (e.g. "30m", "2h"), seconds as digits, or -1 to pin until restart.',
    )
    ollama_num_predict: int = Field(
        default=768,
        ge=0,
        le=8192,
        validation_alias="OLLAMA_NUM_PREDICT",
        description="Max new tokens per completion; 0 = omit (model default).",
    )
    ollama_temperature: float = Field(
        default=0.2,
        ge=0.0,
        le=2.0,
        validation_alias="OLLAMA_TEMPERATURE",
        description="Sampling temperature for Enterprise AI summaries.",
    )
    ai_llm_timeout_seconds: float = Field(default=45.0, validation_alias="AI_LLM_TIMEOUT_SECONDS")
    ai_query_timeout_seconds: float = Field(default=12.0, validation_alias="AI_QUERY_TIMEOUT_SECONDS")
    ai_chat_rate_limit_per_minute: int = Field(default=30, ge=5, validation_alias="AI_CHAT_RATE_LIMIT_PER_MINUTE")
    ai_llm_max_rows: int = Field(default=40, ge=5, validation_alias="AI_LLM_MAX_ROWS")
    ai_llm_max_prompt_chars: int = Field(default=12_000, validation_alias="AI_LLM_MAX_PROMPT_CHARS")
    ai_suggestions_cache_ttl_seconds: int = Field(default=120, validation_alias="AI_SUGGESTIONS_CACHE_TTL_SECONDS")
    ai_kpi_trend_max_days: int = Field(default=30, ge=1, le=366, validation_alias="AI_KPI_TREND_MAX_DAYS")
    ai_kpi_trend_max_rows: int = Field(default=500, ge=10, le=5000, validation_alias="AI_KPI_TREND_MAX_ROWS")
    ai_alert_llm_failures_threshold: int = Field(default=5, ge=1, validation_alias="AI_ALERT_LLM_FAILURES_THRESHOLD")
    ai_alert_llm_cooldown_seconds: int = Field(default=3600, ge=60, validation_alias="AI_ALERT_LLM_COOLDOWN_SECONDS")
    ai_alert_planner_failures_threshold: int = Field(
        default=5, ge=1, validation_alias="AI_ALERT_PLANNER_FAILURES_THRESHOLD"
    )
    ai_alert_execution_failures_threshold: int = Field(
        default=5, ge=1, validation_alias="AI_ALERT_EXECUTION_FAILURES_THRESHOLD"
    )
    ai_alert_pipeline_cooldown_seconds: int = Field(
        default=900,
        ge=60,
        validation_alias="AI_ALERT_PIPELINE_COOLDOWN_SECONDS",
        description="Cooldown for planner vs execution AI failure alerts (shared).",
    )

    alert_dedupe_ai_chat_cooldown_seconds: int = Field(
        default=600,
        ge=60,
        validation_alias="ALERT_DEDUPE_AI_CHAT_COOLDOWN_SECONDS",
    )
    published_service_delivery_log_retention_days: int | None = Field(
        default=None,
        validation_alias="PUBLISHED_SERVICE_DELIVERY_LOG_RETENTION_DAYS",
        description="If set, use prune_published_service_delivery_logs() from a scheduler to delete older rows.",
    )

    # MQTT ingest (Mosquitto + worker-mqtt-bridge) — monitoring + ports deployment hints
    platform_mqtt_broker_enabled: bool = Field(
        default=False,
        validation_alias="PLATFORM_MQTT_BROKER_ENABLED",
        description="True when Eclipse Mosquitto (or equivalent) is deployed in-stack.",
    )
    mqtt_bridge_deployed: bool = Field(
        default=False,
        validation_alias="MQTT_BRIDGE_DEPLOYED",
        description="True when worker-mqtt-bridge consumes the telemetry broker.",
    )
    mqtt_broker_probe_host: str = Field(
        default="127.0.0.1",
        validation_alias="MQTT_BROKER_PROBE_HOST",
        description="TCP probe target from the API container (e.g. mosquitto in Docker network).",
    )
    mqtt_broker_probe_port: int = Field(
        default=1883,
        validation_alias="MQTT_BROKER_PROBE_PORT",
    )
    platform_mqtt_external_hostname_hint: str | None = Field(
        default=None,
        validation_alias="PLATFORM_MQTT_EXTERNAL_HOST_HINT",
        description="Hostname or IP operators should give field sensors (LAN gateway, DNS name).",
    )
    mqtt_ingest_alert_on_broker_down: bool = Field(
        default=True,
        validation_alias="MQTT_INGEST_ALERT_ON_BROKER_DOWN",
    )

    coap_listener_deployed: bool = Field(
        default=False,
        validation_alias="COAP_LISTENER_DEPLOYED",
        description="True when platform CoAP ingest adapter is running.",
    )
    websocket_ingest_deployed: bool = Field(
        default=False,
        validation_alias="WEBSOCKET_INGEST_DEPLOYED",
        description="True when platform WebSocket ingest adapter is running.",
    )
    rest_poller_deployed: bool = Field(
        default=False,
        validation_alias="REST_POLLER_DEPLOYED",
        description="True when worker-rest-poller polls device REST endpoints (rest_mode=polling).",
    )
    ingest_rest_failures_alert_threshold_15m: int = Field(
        default=25,
        ge=3,
        validation_alias="INGEST_REST_FAILURES_ALERT_THRESHOLD_15M",
        description="Deep monitoring emits ingest alert when REST failures in rolling ~15m window exceed this.",
    )
    ingest_coap_quality_events_alert_threshold_15m: int = Field(
        default=40,
        ge=3,
        validation_alias="INGEST_COAP_QUALITY_EVENTS_ALERT_THRESHOLD_15M",
        description="Deep monitoring: CoAP malformed / client-error signals in rolling ~15m (Redis quality_events zset).",
    )
    ingest_websocket_reconnect_events_alert_threshold_15m: int = Field(
        default=35,
        ge=3,
        validation_alias="INGEST_WEBSOCKET_RECONNECT_EVENTS_ALERT_THRESHOLD_15M",
        description="Deep monitoring: WebSocket reconnect-loop events in rolling ~15m.",
    )
    ingest_rest_poller_quality_events_alert_threshold_15m: int = Field(
        default=25,
        ge=3,
        validation_alias="INGEST_REST_POLLER_QUALITY_EVENTS_ALERT_THRESHOLD_15M",
        description="Deep monitoring: REST poller transport/HTTP/parse failures in rolling ~15m.",
    )
    ingest_hot_stream_inactivity_seconds: int = Field(
        default=0,
        ge=0,
        validation_alias="INGEST_HOT_STREAM_INACTIVITY_SECONDS",
        description="If >0, deep monitoring warns when a previously active adapter (message_count ≥ min) has no payload this long.",
    )
    ingest_inactivity_min_prior_messages: int = Field(
        default=5,
        ge=1,
        validation_alias="INGEST_INACTIVITY_MIN_PRIOR_MESSAGES",
        description="Minimum archived message_total on adapter snapshot before inactivity alert applies.",
    )

settings = Settings()
