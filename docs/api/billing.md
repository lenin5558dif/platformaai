# Billing API

## Refill Balance

`POST /api/billing/refill`

Allows administrators to manually increase a user's balance.

### Authorization

- **Required Role**: `ADMIN`
- **Authentication**: Session required

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

### Audit Logging

All attempts (success and failure) are logged in the `AuditLog` table with action `BILLING_REFILL`.
