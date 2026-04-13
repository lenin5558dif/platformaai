-- Each ADD VALUE in its own transaction (Postgres requirement).
ALTER TYPE "AuditAction" ADD VALUE 'ORG_PROVIDER_CREDENTIAL_UPDATED';
