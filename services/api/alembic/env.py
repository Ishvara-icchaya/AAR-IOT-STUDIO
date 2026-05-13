import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.db.base import Base
from app.db.session import alembic_url_metadata
from app.models import (  # noqa: F401
    AiQuery,
    AiSavedQuery,
    Alert,
    CandidateLatestDeviceState,
    CandidateScrubbedEvent,
    CandidateWorkflowResult,
    ControlPlaneAuditEvent,
    Customer,
    DataObject,
    Dashboard,
    DashboardUserPreference,
    Device,
    DeviceVersion,
    DeviceVersionLineage,
    DeviceEndpoint,
    DeviceImportAudit,
    DeviceObject,
    Endpoint,
    LatestDeviceState,
    LlmConfig,
    MonitoringConfig,
    OtaCampaign,
    OtaCampaignTarget,
    OtaEvent,
    PlatformPort,
    PlatformPortSettings,
    PublishedService,
    PublishedServiceDeliveryLog,
    RawDataObject,
    ResolvedDevice,
    ResultObjectDefinition,
    ScrubbedEvent,
    SimulationJob,
    Site,
    StaticIngestion,
    User,
    UserSite,
    WorkspaceMessage,
    Workflow,
    WorkflowEdge,
    WorkflowExecution,
    WorkflowNode,
    WorkflowNodeOutput,
    WorkflowResultObject,
)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    return os.environ.get("ALEMBIC_DATABASE_URL", alembic_url_metadata())


def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
