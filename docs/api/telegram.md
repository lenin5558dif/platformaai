# Telegram Integration API

This document describes the API endpoints for linking and unlinking Telegram accounts.
Telegram web login is a separate surface and works only for accounts that are already linked to Telegram.

## Authentication

All endpoints require an authenticated session. See [Error Semantics](#error-semantics) for details on authentication failures.

## Error Semantics

- `401 Unauthorized`: missing/invalid session
- `403 Forbidden`: authenticated but operation not allowed
- `429 Too Many Requests`: rate limit exceeded
- `500 Internal Server Error`: unexpected server error

## Generate Link Token

`POST /api/telegram/token`

Generates a time-limited token for linking a Telegram account. Returns a deep link that the user can open in Telegram to initiate the linking flow.

### Authorization

- **Authentication**: Session required

### Rate Limiting

- **Limit**: 5 requests per minute per user
- **Status on exceeded**: `429 Too Many Requests`

### Request Body

None required.

### Response

- **200 OK**: Token generated successfully.
  ```json
  {
    "token": "abc123xyz...",
    "deepLink": "https://t.me/MyBot?start=abc123xyz...",
    "expiresAt": "2026-02-03T12:34:56Z"
  }
  ```

### Security Notes

- Token TTL is capped at 10 minutes maximum.
- The token MUST be treated as a secret. The server never logs it; clients SHOULD NOT log it.
- Storage uses a prefix + hash format for lookup. The full token is returned once in the response and included in the Telegram deep link.

## Unlink Telegram Account

`DELETE /api/telegram/unlink`

Removes the link between the current user account and any associated Telegram account.

### Authorization

- **Authentication**: Session required

### Idempotency

This endpoint is idempotent. Calling it multiple times succeeds even if no link exists.

### Response

- **204 No Content**: Successfully unlinked (or no link existed).

### Audit Logging

A `TELEGRAM_UNLINKED` audit event is recorded on successful unlink.

## Bot Flow

When a user opens the deep link and sends `/start <token>` to the bot:

1. The bot validates the token and looks up the associated user account.
2. The bot prompts the user with a confirmation dialog showing a **masked email** (e.g., `j***@example.com`).
3. User options:
   - **Confirm**: Finalizes the linking process.
   - **Cancel**: Aborts the linking process and the token is invalidated.

## Global Revoke Parity

After a user performs a **revoke-all sessions** action:

- All existing Telegram access is immediately rejected.
- The Telegram account remains linked but cannot perform bot actions until the user generates a new link token in the web application and re-confirms the Telegram link.

## Deployment Notes

### Telegram Login Widget Requirements

- `NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED=0` explicitly hides Telegram login in the UI. If the flag is omitted, Telegram login is allowed when the bot config is valid.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_LOGIN_BOT_NAME`, and `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME` must all be set and refer to the same bot.
- The exact public HTTPS domain must be configured in BotFather for the Telegram Login Widget.
- After changing Telegram env values, do a full rebuild and redeploy, not only a process restart.

### Database Migration

The following schema changes are required:

- Add `telegramLinkTokenHash` column (indexed) for secure token lookups.
- Add `globalRevokeCounter` column to track session revocation epochs.

### Safe Rollout

During the rollout window:

1. The bot accepts both legacy plaintext tokens and the new prefix+hash format.
2. New tokens are stored as prefix+hash (the full token is not stored).
3. After full deployment and TTL expiry, legacy plaintext token rows can be cleaned up and the fallback can be removed.

This ensures zero-downtime deployment with backward compatibility.
