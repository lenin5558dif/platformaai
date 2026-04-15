# Billing API

## Billing Summary

`GET /api/billing/summary`

Returns the current user billing snapshot for the active period.

### Authorization

- Session required

### Response shape

```json
{
  "balance": "30",
  "topUpBalance": "30",
  "includedCreditsRemaining": "75",
  "dailySpent": "5",
  "monthlySpent": "2",
  "dailyLimit": "50",
  "monthlyLimit": "100",
  "subscription": {
    "status": "ACTIVE",
    "currentPeriodStart": "2026-04-01T00:00:00.000Z",
    "currentPeriodEnd": "2026-05-01T00:00:00.000Z",
    "includedCredits": "100.00",
    "includedCreditsUsed": "25.00",
    "cancelAtPeriodEnd": false,
    "plan": {
      "code": "creator",
      "name": "Креатор",
      "monthlyPriceUsd": "29.00",
      "includedCreditsPerMonth": "100.00"
    }
  },
  "org": null,
  "transactions": []
}
```

Current spending logic is hybrid:

- credits included in the active subscription are spent first
- top-up balance is spent after included credits are exhausted

## Refill Balance

`POST /api/billing/refill`

Allows administrators to manually increase a user's balance.

### Authorization

- **Required Role**: `ADMIN`
- **Authentication**: Session required
- **Header**: `x-billing-refill-token` must match `BILLING_REFILL_TOKEN`

### Request Body

```json
{
  "amount": 100,
  "description": "Optional reason for refill"
}
```

- `amount` (number, required): Positive amount to add to balance.
- `description` (string, optional): Description for the transaction.

### Responses

- **201 Created**: Balance successfully updated.
  ```json
  {
    "transaction": {
      "id": "tx_...",
      "amount": "100",
      ...
    },
    "balance": "150"
  }
  ```
- **401 Unauthorized**: User is not logged in.
- **403 Forbidden**: User is logged in but is not an ADMIN.
- **503 Service Unavailable**: Manual refill is not configured.

### Audit Logging

All attempts (success and failure) are logged in the `AuditLog` table with action `BILLING_REFILL`.
