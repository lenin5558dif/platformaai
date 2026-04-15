# Documentation Index

This directory contains the project documentation that should stay aligned with the codebase.

## Deployment

- [deployment/self-hosted.md](./deployment/self-hosted.md) production and self-hosted runtime notes
- [deployment/operations.md](./deployment/operations.md) backup, restore, deploy, rollback, smoke checks
- [deployment/ui-audit-2026-04-15.md](./deployment/ui-audit-2026-04-15.md) dated production UI audit snapshot

## API and operational notes

- [api/billing.md](./api/billing.md)
- [api/org-invites.md](./api/org-invites.md)
- [api/rbac.md](./api/rbac.md)
- [api/telegram.md](./api/telegram.md)
- [api/audit-log-retention.md](./api/audit-log-retention.md)

## Update rule

Before changing docs, verify behavior in:

- `package.json`
- `.env.example`
- `src/lib/env.ts`
- `src/app`
- `src/app/api`
- `docker-compose.yml`

Keep the production deployment docs aligned with the deploy-safe migration
script and feature flags such as temporary access.
