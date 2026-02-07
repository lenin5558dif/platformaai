# Org Invites API

This document describes organization invite management endpoints.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/org/invites` | List pending invites |
| `POST` | `/api/org/invites` | Create a new invite |
| `POST` | `/api/org/invites/[id]/revoke` | Revoke an existing invite |
| `POST` | `/api/org/invites/[id]/resend` | Resend an invite (rotates token) |
| `POST` | `/api/org/invites/accept` | Accept an invite |

## Rate Limit Headers

When an endpoint returns **429 Too Many Requests**, it includes:

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Max requests per window |
| `X-RateLimit-Remaining` | Remaining requests in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |
| `Retry-After` | Seconds until retry is allowed |

## List Invites

`GET /api/org/invites`

### Authorization
- Authentication required
- Permission: `org:invite.create`

### Response
- **200 OK**
  ```json
  {
    "data": [
      {
        "id": "invite_1",
        "email": "user@example.com",
        "roleId": "role_1",
        "defaultCostCenterId": null,
        "tokenPrefix": "abcd1234",
        "expiresAt": "2026-02-03T12:00:00Z",
        "createdAt": "2026-02-03T11:00:00Z",
        "role": { "id": "role_1", "name": "Member" }
      }
    ]
  }
  ```

## Create Invite

`POST /api/org/invites`

### Authorization
- Authentication required
- Permission: `org:invite.create`

### Rate limiting
- 10 per hour per user per org

### Request body
```json
{ "email": "user@example.com", "roleId": "role_1", "defaultCostCenterId": null }
```

### Response
- **201 Created**
  ```json
  {
    "data": {
      "id": "invite_1",
      "email": "user@example.com",
      "roleId": "role_1",
      "tokenPrefix": "abcd1234",
      "expiresAt": "2026-02-10T12:00:00Z",
      "acceptUrl": "https://.../api/org/invites/accept?token=...",
      "token": "..."
    }
  }
  ```

### Audit
- On success: `AuditAction.USER_INVITED`

## Revoke Invite

`POST /api/org/invites/[id]/revoke`

### Authorization
- Authentication required
- Permission: `org:invite.revoke`

### Response
- **200 OK**
  ```json
  { "ok": true }
  ```

### Audit
- On success: `AuditAction.USER_UPDATED`

## Resend Invite

`POST /api/org/invites/[id]/resend`

Resends the invitation email and rotates the invite token (old token becomes invalid).

### Authorization
- Authentication required
- Permission: `org:invite.create`

### Rate limiting
- 10 per hour per user per org

### Response
- **200 OK**
  ```json
  { "ok": true }
  ```

### Audit
- On success: `AuditAction.ORG_INVITE_RESENT`

## Accept Invite

`POST /api/org/invites/accept`

### Authorization
- Authentication required

### Rate limiting
- 5 attempts per 15 minutes per token (keyed by token hash)

### Verified email enforcement
If the session exposes an email verification signal:

| `session.user.emailVerified` | Behavior |
|------------------------------|----------|
| `false` | reject with **403 EMAIL_NOT_VERIFIED** |
| `true` | proceed |
| `null`/`undefined` | proceed (no enforcement) |

### Request body
```json
{ "token": "..." }
```

### Response
- **200 OK**
  ```json
  { "ok": true }
  ```

### Audit
- On rate limit: `AuditAction.ORG_INVITE_ACCEPT_RATE_LIMITED`
- On unverified rejection: `AuditAction.ORG_INVITE_ACCEPT_REJECTED_UNVERIFIED`
- On success: `AuditAction.USER_UPDATED`
