## Context

The `/api/billing/refill` endpoint is intended for administrative use to manually adjust user balances. Currently, it only checks for authentication but not authorization, allowing any logged-in user to increase their balance.

## Goals / Non-Goals

### Goals
- Restrict refill endpoint to admin users only
- Maintain audit trail for all refill operations
- Preserve existing functionality for authorized admins

### Non-Goals
- Implementing a new payment gateway integration (separate concern)
- Changing the transaction model structure
- Adding rate limiting (can be done separately)

## Decisions

### Decision 1: Admin Role Check
**What**: Add a role-based authorization check at the beginning of the POST handler.

**Why**: This is the simplest and most direct fix. The user model already supports roles, so we leverage existing infrastructure.

**Alternatives considered**:
1. API key authentication - More complex, requires key management
2. Separate admin API route - Would require restructuring, higher effort
3. Middleware-based auth - Overkill for single endpoint

### Decision 2: Audit Logging
**What**: Log all refill attempts (both successful and rejected) with user ID, amount, and timestamp.

**Why**: Critical for security incident investigation and compliance.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Breaking legitimate admin workflows | Ensure admin role is properly assigned before deployment |
| Missing role field in user model | Verify schema includes role; add migration if needed |

## Migration Plan

1. Verify `role` field exists on User model
2. Deploy updated endpoint
3. No data migration needed - this is a permission change only
4. Rollback: revert code if issues arise

## Open Questions

- [ ] Is there an existing admin role constant/enum to use?
- [ ] Should we notify users who previously exploited this? (policy decision)
