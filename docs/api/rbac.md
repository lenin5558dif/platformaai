# Enterprise RBAC/ABAC

This document describes organization-scoped permissions and error semantics for enterprise features.

## Permission Keys

Permission keys are defined in `src/lib/org-permissions.ts`.

| Key | Meaning |
| --- | --- |
| `org:settings.update` | Update organization settings (including SSO domains) |
| `org:user.manage` | Manage organization users (enable/disable, remove member) |
| `org:invite.create` | Create invites / add members |
| `org:invite.revoke` | Revoke invites |
| `org:role.change` | Change member roles |
| `org:billing.manage` | Manage org billing/budget and internal transfers |
| `org:billing.refill` | Manual refill of user balance (admin-only operation) |
| `org:policy.update` | Update model policy and DLP policy |
| `org:audit.read` | Read audit log |
| `org:analytics.read` | Read analytics/export events |
| `org:scim.manage` | Manage SCIM tokens and provisioning |
| `org:cost-center.manage` | Manage cost centers and assignments |
| `org:limits.manage` | Manage user limits and quotas |

## System Roles

System roles are seeded per organization and mapped to permissions.

Role names:
- `Owner`
- `Admin`
- `Manager`
- `Member`

Default mapping (seeded in `prisma/seed.ts` and helper logic in `src/lib/org-rbac.ts`):

- `Owner`: all permissions
- `Admin`: most org-management permissions (including billing, policies, SCIM)
- `Manager`: read-only governance (currently `org:analytics.read`, `org:audit.read`)
- `Member`: no org-management permissions

Note: server-side permissions are the source of truth; UI gating should follow but not replace server enforcement.

## Error Semantics

These status codes are used consistently across routes and channels:

- `401 Unauthorized`: missing/invalid session
- `403 Forbidden`: authenticated but missing org membership or missing required permission
- `400 Bad Request`: request rejected by DLP or other input validation
- `402 Payment Required`: insufficient balance
- `409 Conflict`: limit exceeded (daily/monthly/org budget) or invariants violated
- `429 Too Many Requests`: rate limit
- `404 Not Found`: resource missing or cross-scope lookup rejected as not found

### Policy Blocks (Model Policy / DLP)

Model policy blocks:
- status: `403`
- user-facing message (RU): `"Модель запрещена политикой организации."`
- audit: `POLICY_BLOCKED` with `targetType: "model"`

DLP blocks:
- status: `400`
- user-facing message (RU): `"Запрос отклонен политикой DLP."`
- audit: `POLICY_BLOCKED` with `targetType: "dlp"` and `metadata.matches`

DLP redaction:
- request is allowed with content redacted (replaced with `[REDACTED]`)
- audit: `POLICY_BLOCKED` with `targetType: "dlp"` and `metadata.action: "redact"`

## Management APIs

### Roles

`GET /api/org/roles`

- **Authorization**: requires `org:role.change`
- Lists system and custom roles for the current organization, including permission keys.

`POST /api/org/roles`

- **Authorization**: requires `org:role.change`
- Creates a custom role: `{ name, permissionKeys }`
- `400` if any permission key is unknown
- `409` if role name already exists in the org

`PATCH /api/org/roles/:id`

- **Authorization**: requires `org:role.change`
- Updates a non-system role (name and/or permissions)
- `403` for system roles

`DELETE /api/org/roles/:id`

- **Authorization**: requires `org:role.change`
- Deletes a non-system role
- `403` for system roles
- `409` if role is in use by memberships/invites

### Cost Center Access (Allowed Set)

Allowed cost centers are enforced as:

- If a membership has **0** allowed cost centers configured: user can charge **any** cost center in the org.
- If a membership has **>=1** allowed cost centers configured: user can charge **only** those.

`GET /api/org/users/:id/cost-centers`

- **Authorization**: requires `org:cost-center.manage`
- Returns the member's `defaultCostCenterId` and `allowedCostCenterIds`

`PATCH /api/org/users/:id/cost-centers`

- **Authorization**: requires `org:cost-center.manage`
- Body: `{ defaultCostCenterId?: string|null, allowedCostCenterIds?: string[] }`
- Setting `allowedCostCenterIds: []` clears restrictions (reverts to allow-all)

### Limits And Quotas

`GET /api/org/limits/summary`

- **Authorization**: requires `org:limits.manage`
- Returns current org budget utilization and active reservation totals
- Optional query: `?userId=<id>` to include that member's daily/monthly limits + utilization

`GET /api/org/cost-centers/:id/budget`

- **Authorization**: requires `org:limits.manage`
- Returns the cost center budget (all-time) and spent amount

`PATCH /api/org/cost-centers/:id/budget`

- **Authorization**: requires `org:limits.manage`
- Body: `{ budget?: number|null }`
- `budget: null` disables the budget (treats it as unlimited)
- `409` if the budget/quota would be exceeded
