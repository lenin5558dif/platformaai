# Production Readiness Fix Plan

Updated: 2026-04-15

## Goal

Bring PlatformaAI to a state where the live deployment has:

- consistent unauthenticated redirect behavior for private routes
- a verified login surface and authenticated app entry flow
- source-backed deployment and environment documentation
- production-relevant smoke coverage instead of homepage-only happy paths

## Current Status

Observed during readiness review:

- live `health` and `readiness` are green
- live auth perimeter is still inconsistent on some HTML routes
- workspace already contains partial auth/page-guard fixes that are not yet reflected on the live server
- browser smoke coverage is too narrow for a production sign-off

## Blocking Issues

### P0

- Align live private-route behavior with current auth contract
  - `/` must require session
  - private pages must redirect unauthenticated users to `/login?mode=signin`
  - role-gated pages must preserve signed-in access denied behavior

- Re-verify live login and protected-route behavior after deploy
  - `/login`
  - `/`
  - `/models`
  - `/billing`
  - `/org`
  - `/audit`
  - `/admin`

- Expand smoke coverage for production-relevant browser paths
  - unauthenticated login page
  - unauthenticated redirect from private routes
  - one authenticated app flow
  - one mobile breakpoint smoke

### P1

- Bring env contract in sync with code
  - document and validate temp-access env keys if feature is kept
  - verify auth capability flags are fully represented in `.env.example` and `src/lib/env.ts`

- Make migration scripting safer for production
  - avoid `prisma migrate dev` under a production-sounding script

- Reduce confusing public-shell chrome on public pages like `/pricing`

### P2

- Remove or harden dead public surfaces such as the Telegram webhook no-op route
- Normalize docs and operational runbooks after fixes land

## Workstreams

### Workstream A: Auth Perimeter

Owner: main thread

Scope:

- `src/app/page.tsx`
- private pages under `src/app/*`
- auth redirects vs signed-in forbidden states
- related tests in `tests/dashboard-pages.test.ts`, `tests/simple-pages.test.ts`, `tests/statement-roi-small-cluster.test.ts`, `tests/e2e/smoke.spec.ts`

Success criteria:

- no guest shell on private routes
- live behavior matches route intent

### Workstream B: Deploy and Env Contract

Owner: delegated agent

Scope:

- `.env.example`
- `src/lib/env.ts`
- `package.json`
- deployment docs if behavior changes

Success criteria:

- env docs match feature flags in code
- production migration path is explicit and safer

### Workstream C: Browser Smoke and Readiness

Owner: delegated agent

Scope:

- `tests/e2e/*`
- supporting scripts for server-side verification
- docs for smoke expectations if needed

Success criteria:

- smoke coverage proves more than homepage render
- checks are meaningful for production deploy validation

## Integration Rules

- Do not revert unrelated local changes.
- Keep public routes public: `/login`, `/pricing`, `/invite/accept`, `/share/[token]`.
- Keep signed-in forbidden states where appropriate: `/admin`, `/audit`, org RBAC sections.
- Prefer minimal, source-backed changes.

## Definition of Done

- blockers above resolved in code
- tests/docs updated to match real behavior
- live server rechecked after deploy
- final readiness verdict updated from “not ready” to either “ready” or a much smaller residual-risk list
