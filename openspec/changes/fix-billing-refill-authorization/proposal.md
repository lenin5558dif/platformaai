# Change: Fix Unauthorized Credit Refill via /api/billing/refill

## Why

The `/api/billing/refill` endpoint allows any authenticated user to increase their balance without payment or admin privileges. This is a critical security vulnerability that enables direct financial bypass.

## What Changes

- **BREAKING**: Add admin role authorization check to the refill endpoint
- Add payment verification requirement before balance increment
- Log all refill attempts for audit purposes
- Return 403 Forbidden for non-admin users attempting direct refill

## Impact

- Affected specs: `billing`
- Affected code: `src/app/api/billing/refill/route.ts`
- Users can no longer self-refill; only admins or verified payment flows will update balances

## Problem Details

### Current Behavior (Vulnerable)

```tsx
// src/app/api/billing/refill/route.ts:11-46
export async function POST(request: Request) {
  const session = await auth();
  // Only checks if user is authenticated, NOT if they have permission
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Directly increments balance without payment verification
  const updated = await tx.user.update({
    data: { balance: { increment: payload.amount } },
  });
}
```

### Reproduction Steps

1. Login as any regular user
2. Execute `POST /api/billing/refill` with body `{ "amount": 100 }`
3. Observe balance increased without payment

### Expected Behavior

- Only admin users or verified payment callbacks should be able to increment balance
- Regular users should receive 403 Forbidden
