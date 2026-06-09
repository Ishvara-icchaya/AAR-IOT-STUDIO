# Contributing to AAR IoT Studio

Thank you for your interest in contributing. This project is open source under the [Apache License 2.0](LICENSE).

## Getting started

1. Fork the repository and clone your fork.
2. Copy `.env.example` to `.env` and start the stack: `docker compose up -d --build`.
3. For frontend work: `npm install --prefix services/frontend`.
4. For API work: create a virtualenv under `services/api`, install `requirements.txt`, and point `DATABASE_URL` at the Compose Postgres instance.

See the root [README](README.md) for ports, optional LLM profile, and local development without Docker.

## How to contribute

- **Bug reports:** Open an issue with reproduction steps, expected vs actual behavior, and environment (OS, Docker version, relevant env vars).
- **Features:** Open an issue first for substantial changes so design can be discussed against existing contracts in `docs/`.
- **Pull requests:** Keep changes focused; include tests when behavior changes; update documentation when contracts or operator workflows change.

## Code expectations

- Match existing patterns in the area you touch (API services, workers, React components).
- Run `npm run lint` and `npm run build` in `services/frontend` for UI changes.
- Run relevant API tests under `services/api/tests/` for backend changes.
- Do not commit secrets (`.env`, credentials, tokens).

## Documentation

Product and engineering contracts live under `docs/`. When you change normative behavior (ingest, versioning, dashboards, scrubber steps), update the relevant spec or add a short note to the iteration log if the change is incremental.

## Community standards

Be respectful and constructive in issues and reviews. We welcome contributors of all experience levels.
