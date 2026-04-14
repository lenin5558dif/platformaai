# Audit Log Retention and Alerting

This document describes the audit log purge job, configuration, metrics, and alerting.

## 1. Purge Job Behavior

The purge job removes audit log entries older than the configured retention period.

- **Retention cutoff**: Entries with `createdAt <= (now - retentionDays)` are deleted
- **Inclusive boundary**: The cutoff is inclusive; entries exactly at the boundary are purged
- **Batch processing**: Deletes are performed in configurable batches to limit database load
- **Runtime limit**: The job stops after `maxRuntimeMinutes` to avoid overlapping runs
- **Dry run mode**: When enabled, logs what would be deleted without performing deletions

## 2. Configuration

Configuration is loaded from environment variables in `src/lib/audit-log-config.ts`.

### 2.1 Retention Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_LOG_RETENTION_ENABLED` | `false` | Enable the purge job |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Number of days to retain logs (minimum: 7) |
| `AUDIT_LOG_RETENTION_BATCH_SIZE` | `1000` | Records to delete per batch |
| `AUDIT_LOG_RETENTION_BATCH_DELAY_MS` | `100` | Delay between batches in milliseconds |
| `AUDIT_LOG_RETENTION_MAX_RUNTIME_MINUTES` | `5` | Maximum job runtime before forced exit |
| `AUDIT_LOG_RETENTION_DRY_RUN` | `false` | Log deletions without executing them |

Optional in-process scheduling (self-hosted deployments only):

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_LOG_PURGE_INTERVAL_MS` | `0` | If set to a positive number, runs purge in-process on an interval |

### 2.2 Metrics Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_LOG_METRICS_ENABLED` | `false` | Enable audit log metrics collection |
| `AUDIT_LOG_METRICS_ACTION_TYPES` | `""` | Comma-separated action type whitelist (empty = all) |

Action types for filtering: `CREATE`, `UPDATE`, `DELETE`, `AUTH`, `POLICY`, `BILLING`, `OTHER`.

### 2.3 Cron Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes | Shared secret for internal cron endpoints |

All internal cron endpoints require the `x-cron-secret` header to match `CRON_SECRET`.

## 3. Scheduling

### 3.1 Triggering the Purge Job

```bash
POST /api/internal/cron/audit-log-purge
Headers:
  x-cron-secret: <CRON_SECRET>
```

**Recommended schedule**: Daily during off-peak hours (e.g., 3:00 AM).

**Example cron expression**:
```bash
0 3 * * * curl -X POST https://api.example.com/api/internal/cron/audit-log-purge \
  -H "x-cron-secret: $CRON_SECRET"
```

### 3.2 Response Format

```json
{
  "ok": true,
  "skipped": false,
  "cutoffIso": "2024-11-01T00:00:00.000Z",
  "dryRun": false,
  "batches": 15,
  "scanned": 15000,
  "deleted": 15000,
  "durationMs": 12500,
  "stoppedReason": "completed",
  "errors": 0
}
```

## 4. Metrics

### 4.1 Endpoint

```bash
GET /api/internal/metrics
Headers:
  x-cron-secret: <CRON_SECRET>
```

Returns Prometheus-formatted metrics.

### 4.2 Metric Names

| Metric | Type | Description |
|--------|------|-------------|
| `audit_log_entries_total` | Counter | Total audit log entries created |
| `audit_log_purge_records_total` | Counter | Total audit log records purged |
| `audit_log_purge_errors_total` | Counter | Total errors during purge |
| `audit_log_purge_duration_seconds` | Histogram | Purge job duration |
| `audit_log_purge_last_success_timestamp_seconds` | Gauge | Unix timestamp of last successful purge |
| `audit_log_oldest_retained_age_seconds` | Gauge | Age (seconds) of oldest retained audit log |
| `audit_log_errors_total` | Counter | Total audit log operation errors |

Labels:
- `audit_log_entries_total`: `action_type`, `entity_type`
- `audit_log_errors_total`: `error_type`

## 5. Alerting Guidance

### 5.1 Purge Job Failures

Alert when the purge job fails or encounters errors:

```yaml
- alert: AuditLogPurgeErrors
  expr: increase(audit_log_purge_errors_total[1h]) > 0
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Audit log purge encountered errors"
    description: "{{ $value }} errors during audit log purge in the last hour"
```

### 5.2 Purge Job Not Running

Alert when no purge activity is detected for an extended period:

```yaml
- alert: AuditLogPurgeStale
  expr: time() - audit_log_purge_last_success_timestamp_seconds > 86400
  for: 1h
  labels:
    severity: critical
  annotations:
    summary: "Audit log purge has not run in 24 hours"
    description: "Last successful purge was more than 24 hours ago"
```

### 5.3 Audit Log Volume Spike

Alert on unusual volume increases:

```yaml
- alert: AuditLogVolumeSpike
  expr: |
    rate(audit_log_entries_total[5m])
    >
    avg_over_time(rate(audit_log_entries_total[5m])[1d:5m])
    +
    3 * stddev_over_time(rate(audit_log_entries_total[5m])[1d:5m])
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "Audit log volume spike detected"
    description: "Audit log rate is 3x higher than 24h average"
```

### 5.4 Database Growth Risk

Alert when purge is not keeping up with ingestion:

```yaml
- alert: AuditLogRetentionRisk
  expr: |
    (
      increase(audit_log_entries_total[24h])
      -
      increase(audit_log_purge_records_total[24h])
    ) > 1000000
  for: 1h
  labels:
    severity: critical
  annotations:
    summary: "Audit log retention may not be keeping up"
    description: "Net growth of {{ $value }} records in 24h exceeds threshold"

### 5.6 Retention Lag Detection

Alert when the oldest retained audit log entry age exceeds the retention target by 1 hour:

```yaml
- alert: AuditLogRetentionLag
  expr: audit_log_oldest_retained_age_seconds > (90 * 86400 + 3600)
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: "Audit log retention lag"
    description: "Oldest retained audit log is older than expected (possible purge lag)"
```

### 5.5 Audit Logging Failures

Alert when audit log writes are failing:

```yaml
- alert: AuditLogWriteErrors
  expr: increase(audit_log_errors_total[5m]) > 10
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Audit log write failures detected"
    description: "{{ $value }} audit log errors in the last 5 minutes"
```

## 6. Tuning Recommendations

### 6.1 Batch Size vs Database Load

| Batch Size | Use Case | Trade-off |
|------------|----------|-----------|
| 100-500 | High-traffic production | Lower lock contention, slower purge |
| 1000 | Default balanced setting | Good throughput with moderate load |
| 5000+ | Low-traffic or maintenance window | Faster purge, higher lock contention |

**Guidelines**:
- Reduce `AUDIT_LOG_RETENTION_BATCH_SIZE` if you see database lock timeouts
- Increase `AUDIT_LOG_RETENTION_BATCH_DELAY_MS` (e.g., to 500ms) during peak hours
- Monitor `audit_log_purge_duration_seconds` to ensure jobs complete within `maxRuntimeMinutes`

### 6.2 Retention Period

- **Compliance requirement**: Set based on regulatory needs (minimum 7 days enforced)
- **Storage constraints**: Balance retention with available database storage
- **Query performance**: Shorter retention improves audit log query performance

### 6.3 Dry Run Mode

Enable `AUDIT_LOG_RETENTION_DRY_RUN=true` to estimate impact before first production run:

```bash
# Check logs for estimated deletions
dryRun: true
cutoff: "2024-11-01T00:00:00.000Z"
wouldDelete: 150000
```
