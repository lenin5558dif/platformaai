-- Each ADD VALUE in its own transaction (Postgres requirement).
ALTER TYPE "AuditAction" ADD VALUE 'PLATFORM_SYSTEM_PROMPT_UPDATED';
