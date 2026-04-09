FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic_ts ./alembic_ts
COPY alembic.ini alembic_timescale.ini ./
COPY scripts/docker-api-entrypoint.sh /docker-api-entrypoint.sh
RUN chmod +x /docker-api-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/docker-api-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
