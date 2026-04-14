# AGENTS.md

This file is the short operational map for contributors and coding agents working in this repository.

## Project shape

- Framework: Next.js 15 App Router
- Language: TypeScript
- Database: PostgreSQL with Prisma
- Auth: Auth.js credentials, optional SSO, optional Telegram
- AI: OpenRouter
- Payments: Stripe
- Bot: Telegraf

Core directories:

- `src/app` pages and route handlers
- `src/components` UI
- `src/lib` business logic and integrations
- `src/bot` Telegram bot
- `prisma` schema, migrations, seed
- `tests` Vitest and Playwright coverage
- `docs` deployment and API notes

## Source of truth

When updating documentation, verify against code instead of inferred behavior:

- `package.json` for scripts
- `.env.example` and `src/lib/env.ts` for env variables and validation rules
- `src/app` for pages
- `src/app/api` for HTTP endpoints
- `docker-compose.yml` and `Dockerfile` for deployment flow
- `src/lib/navigation.ts` for primary navigation

Do not keep hand-maintained counts like "58 modules" or "44 tests" unless you also keep them updated.

## Local workflow

Install and run:

```bash
npm install
cp .env.example .env.local
docker compose up -d postgres
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Useful commands:

```bash
npm run lint
npm test
npm run test:e2e
npm run build
npm run bot:dev
```

## Documentation expectations

Keep these files aligned:

- `README.md` for product overview, setup, routes, and docs map
- `docs/README.md` for the documentation index
- `docs/deployment/*.md` for runtime and operations behavior
- `docs/api/*.md` for stable API or operational contracts
- `.env.example` for documented env toggles that affect user-visible behavior

Current product specifics that are easy to misdocument:

- Web login UI is email + password, not magic-link-first
- `/api/ai/image` describes uploaded images; it is not a general image generation API
- Telegram auth UI depends on `NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED`
- Internal protected endpoints use `x-cron-secret`; there is no generic `/api/internal/cron/*` surface in the current codebase

## Editing guidance

- Prefer minimal, source-backed documentation changes
- Remove stale claims instead of guessing
- If product behavior changed, update docs in the same change as code when possible
