# Operations Runbook

This runbook covers the minimum operational steps for a self-hosted PlatformaAI deployment.
Use it together with [self-hosted.md](./self-hosted.md).

## Pre-Deploy Checklist

- Confirm `.env` is complete for the intended feature set.
- Confirm the database is reachable from the host.
- Confirm the target image or working tree matches the release you intend to deploy.
- Run the deploy-safe migration job before switching traffic to the new app version.
- Keep the previous release or image available for rollback.

## Backup

Before each production deploy, take a PostgreSQL backup.

Example:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=backup-$(date +%Y%m%d-%H%M%S).dump
```

At minimum, verify that:

- the backup command succeeds
- the backup file is stored outside the app container
- retention is managed outside this repository

## Restore

To restore from a custom-format backup:

```bash
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" backup-YYYYMMDD-HHMMSS.dump
```

Run restore only during a controlled maintenance window.
After restore:

- run `docker compose --profile migrate run --rm migrate`
- start the app
- verify health/readiness and a login flow

## Deploy

Example sequence:

```bash
docker compose up -d postgres
docker compose --profile migrate run --rm migrate
docker compose up -d app
```

## Post-Deploy Smoke Checks

```bash
curl -fsS http://localhost:3000/api/internal/health
curl -fsS http://localhost:3000/api/internal/readiness
curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/internal/ops
curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/internal/metrics
```

Then verify manually:

- login page loads
- email, SSO, Telegram, or temporary-access auth surfaces match the configured env
- unauthenticated access to `/` redirects to `/login?mode=signin`
- public routes such as `/pricing`, `/share/[token]`, and `/invite/accept?token=...` still load without a session
- chat page opens for an authenticated user
- org page opens for an org admin
- Stripe checkout route responds as expected in the current environment

## Rollback

Rollback is two separate decisions:

- application rollback: revert to the previous app image or commit
- data rollback: restore the database only if the schema/data change requires it

Preferred order:

1. Stop traffic to the broken release.
2. Restart the previous app version.
3. Re-check `health` and `readiness`.
4. Restore the database only if the failed release introduced incompatible data changes.

Do not restore the database casually after a deploy failure. If migrations were forward-compatible and the old app still works, prefer app-only rollback.

## Recurring Ops

- Treat the audit-log purge scheduler as single-node unless you add a lock or
  external worker; do not let multiple replicas run it independently.
- The current repository does not expose a generic authenticated cron route for
  purge jobs. Use the in-process scheduler or add a dedicated worker/route.
- Scrape `/api/internal/metrics` with `x-cron-secret`, but remember the export
  is process-local and not aggregated across replicas.
- Review disk usage for PostgreSQL volumes and stored backups.
- Rotate secrets on a schedule outside this repository.
