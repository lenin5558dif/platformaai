# API Endpoint Status

## Deprecated (HTTP 410)
- `POST /api/auth/link-telegram`
  - Replaced by token-based Telegram flow:
    - `POST /api/telegram/token`
    - `GET /api/telegram/token?token=<token>`
    - `DELETE /api/telegram/unlink`
- `POST /api/auth/telegram/verify`
  - Replaced by token-based Telegram flow:
    - `POST /api/telegram/token`
    - `GET /api/telegram/token?token=<token>`
- `POST /api/billing/spend`
  - Spending is performed server-side in AI routes after usage accounting:
    - `POST /api/ai/chat`
    - `POST /api/ai/image`
- `POST /api/org/transfer`
  - Replaced by organization UI flow in `/org` (server action `transferCredits`).

## Internal / Protected
- `POST /api/billing/refill`
  - Internal protected endpoint.
  - Requires `ORG_BILLING_REFILL` permission and `x-billing-refill-token`.
