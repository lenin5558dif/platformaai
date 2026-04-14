# Self-hosted Deployment

This document describes the production/self-hosted runtime path for PlatformaAI.
It focuses on container startup, probes, and operational checks.
For backups, restore, rollback, and smoke-check procedures, see [operations.md](operations.md).

## Prerequisites

- Docker with Compose v2
- PostgreSQL 16 or the bundled `postgres` service
- A populated `.env` file based on `.env.example`

The runtime uses the same canonical env contract as the app itself. Keep the
required secrets available in `.env` before starting the containers; the build
does not import the env validator from `next.config.ts`.

## Services

The default `docker-compose.yml` now defines:

- `postgres` - PostgreSQL 16 with a healthcheck
- `app` - Next.js production container built from `Dockerfile`
- `migrate` - one-shot Prisma migration job that runs `prisma migrate deploy`, enabled with the `migrate` profile
- `pgadmin` - optional admin UI, enabled with the `admin` profile

## First Deploy

```bash
cp .env.example .env
docker compose up -d postgres
docker compose --profile migrate run --rm migrate
docker compose up -d app
```

Optional admin UI:

```bash
docker compose --profile admin up -d pgadmin
```

If the schema already exists, the `migrate` step can be repeated independently
after each release to apply any pending production-safe migrations:

```bash
docker compose --profile migrate run --rm migrate
```

## Probes

Use the public `health` endpoint for liveness and the `readiness` endpoint for
rollout gating:

- `GET /api/internal/health`
- `GET /api/internal/readiness`

The readiness check verifies:

- database connectivity
- audit log ops config validity

The app container healthcheck in Compose points at `readiness`, so an unhealthy
DB or invalid ops config marks the service unhealthy instead of letting a broken
release look healthy.

Operational caveat:

- the audit-log purge scheduler is in-process and should be treated as
  single-node only unless you add an external lock or worker
- `/api/internal/metrics` exports the local process registry only, so
  multi-replica deployments need a different metrics backend or a deliberate
  single-scrape strategy

Operational endpoints:

- `GET /api/internal/ops`
- `GET /api/internal/metrics`

Those endpoints require `x-cron-secret` and are intended for internal probes,
metrics scraping, and alerting.

## Runtime Safety

- `AUTH_BYPASS` is rejected in production by startup validation
- `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` must match
- `ops` and `metrics` stay behind `x-cron-secret`
- health/readiness responses are `no-store`
- the Compose app service uses `restart: unless-stopped`
- the app image is built as `standalone` and does not depend on the dev toolchain

Current limitation:

- there is no generic `/api/internal/cron/*` HTTP surface in the repository
- audit-log purge scheduling is in-process via `AUDIT_LOG_PURGE_INTERVAL_MS`

## Suggested Checks

After deploy:

```bash
curl -fsS http://localhost:3000/api/internal/health
curl -fsS http://localhost:3000/api/internal/readiness
curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/internal/ops
curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/internal/metrics
```

If you front the app with a reverse proxy or load balancer, wire the liveness
probe to `/api/internal/health` and the rollout/readiness probe to
`/api/internal/readiness`.
