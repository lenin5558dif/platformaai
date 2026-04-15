-- Each ADD VALUE in its own transaction (Postgres requirement).
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_PASSWORD_RESET_COMPLETED';
