# Self-hosted Deployment

This document describes the current production/self-hosted runtime path for PlatformaAI.
It focuses on the real server process model, probes, and operational checks.
For backups, restore, rollback, and smoke-check procedures, see [operations.md](operations.md).
For SSH access, release paths, and exact host commands, see [../../server.md](../../server.md).

## Prerequisites

- SSH access to the production host
- Node.js and npm available on the host
- PostgreSQL reachable from the host
- A populated `.env` file in the release directory

The runtime uses the same canonical env contract as the app itself. Keep the
required secrets available in `.env` before starting the containers; the build
does not import the env validator from `next.config.ts`.

## Runtime Model

The current server is not running the app through Docker Compose.
Production is started from a release checkout and keeps two Next.js processes listening on ports `3000` and `3001`.

Current public URL:

- `https://ai.aurmind.ru`

## First Deploy

```bash
ssh -i ~/.ssh/platformaai_dokploy_ed25519 platformaai@194.59.40.35
cd /home/platformaai/releases/nikolay
git fetch origin
git checkout nikolay
git pull --ff-only origin nikolay
npm install
npm run prisma:generate
npm run prisma:migrate
npm run build
```

Then restart the two app processes:

```bash
ss -ltnp | grep -E ':3000|:3001'
kill <pid-on-3000> <pid-on-3001>
PORT=3000 nohup npm run start > app-3000.log 2>&1 &
PORT=3001 nohup npm run start > app-3001.log 2>&1 &
```

## Probes

Use the public `health` endpoint for liveness and the `readiness` endpoint for
rollout gating:

- `GET /api/internal/health`
- `GET /api/internal/readiness`

The readiness check verifies:

- database connectivity
- audit log ops config validity

An unhealthy DB or invalid ops config should block the release from being considered healthy.

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
- the production start path should use the built standalone server when present
- `npm run start` is wired to prefer `.next/standalone/server.js`

Current limitation:

- there is no generic `/api/internal/cron/*` HTTP surface in the repository
- audit-log purge scheduling is in-process via `AUDIT_LOG_PURGE_INTERVAL_MS`

## Suggested Checks

After deploy:

```bash
curl -fsS http://127.0.0.1:3000/api/internal/health
curl -fsS http://127.0.0.1:3000/api/internal/readiness
curl -I http://127.0.0.1:3000/login?mode=signin
curl -I http://127.0.0.1:3000/pricing
curl -fsS https://ai.aurmind.ru/api/internal/health
```
