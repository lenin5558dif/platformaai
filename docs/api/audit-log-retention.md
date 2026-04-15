# Audit Log Retention

This document describes the audit log retention configuration that exists in the current codebase.

## Current behavior

- Retention is implemented in `src/lib/audit-log-retention.ts`
- The job wrapper lives in `src/lib/audit-log-purge-job.ts`
- Optional in-process scheduling lives in `src/lib/audit-log-purge-scheduler.ts`
- Readiness and ops status reflect audit-log ops configuration through `/api/internal/readiness` and `/api/internal/ops`
- Metrics are exposed through `/api/internal/metrics`

## Important limitation

The repository does not currently expose a public HTTP purge trigger such as `/api/internal/cron/audit-log-purge`.

Current supported model:

- enable retention via env
- optionally run the in-process scheduler on a single replica with `AUDIT_LOG_PURGE_INTERVAL_MS`
- use `/api/internal/ops` and `/api/internal/metrics` for observability

If you need an external scheduled trigger, you need to add a dedicated route or a separate worker explicitly.

## Environment variables

Retention:

| Variable | Default | Description |
| --- | --- | --- |
| `AUDIT_LOG_RETENTION_ENABLED` | `0` | Enables retention logic |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Retention period in days |
| `AUDIT_LOG_RETENTION_BATCH_SIZE` | `1000` | Delete batch size |
| `AUDIT_LOG_RETENTION_BATCH_DELAY_MS` | `100` | Delay between batches |
| `AUDIT_LOG_RETENTION_MAX_RUNTIME_MINUTES` | `5` | Max runtime for one purge run |
| `AUDIT_LOG_RETENTION_DRY_RUN` | `0` | Report-only mode |
| `AUDIT_LOG_PURGE_INTERVAL_MS` | empty | In-process scheduling interval |

Metrics:

| Variable | Default | Description |
| --- | --- | --- |
| `AUDIT_LOG_METRICS_ENABLED` | `0` | Enables audit metrics |
| `AUDIT_LOG_METRICS_ACTION_TYPES` | empty | Optional action-type allowlist |

Internal auth:

| Variable | Required for | Description |
| --- | --- | --- |
| `CRON_SECRET` | `/api/internal/ops`, `/api/internal/metrics` | Shared secret passed as `x-cron-secret` |

## Operational endpoints

### Readiness

```bash
curl -fsS http://localhost:3000/api/internal/readiness
```

### Ops

```bash
curl -fsS \
  -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3000/api/internal/ops
```

### Metrics

```bash
curl -fsS \
  -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3000/api/internal/metrics
```

## Deployment guidance

- Run the in-process scheduler only on a single replica
- Treat metrics as process-local, not cluster-aggregated
- Keep `AUDIT_LOG_RETENTION_DRY_RUN=1` for first rollout verification if you are unsure about the retention cutoff
