from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _normalize_url(url: str) -> str:
    return url.replace("postgresql+psycopg2://", "postgresql://")


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

timescale_engine = create_engine(settings.timescale_database_url, pool_pre_ping=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def alembic_url_metadata() -> str:
    return _normalize_url(settings.database_url)


def alembic_url_timescale() -> str:
    return _normalize_url(settings.timescale_database_url)
