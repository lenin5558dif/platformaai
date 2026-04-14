# PlatformaAI

[English](#english) | [Русский](#русский)

<a id="english"></a>

## English

PlatformaAI is a multi-model AI workspace built on Next.js 15. It combines chat, file-assisted prompts, web search, billing, organization controls, and optional Telegram/SSO access in one application.

### What is in the product

- Unified chat UI with OpenRouter-backed model selection
- File uploads with text extraction for PDF, DOCX, CSV, TXT, and image attachments
- Optional web search enrichment in chat requests
- Image understanding flow for uploaded images via `/api/ai/image`
- Prompt library, model catalog, billing, pricing, settings, profile, org, timeline, events, audit, and admin pages
- Organization features: invites, RBAC, cost centers, model policy, DLP policy, SCIM tokens
- Telegram bot and Telegram account linking
- Stripe-backed billing and refill flows

### Stack

| Layer | Technology |
| --- | --- |
| App | Next.js 15 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Auth | Auth.js / NextAuth v5 beta, credentials, optional SSO and Telegram |
| Database | PostgreSQL, Prisma |
| AI | OpenRouter |
| Payments | Stripe |
| Bot | Telegraf |
| Tests | Vitest, Playwright |

### Repo layout

```text
src/
  app/          Next.js pages and route handlers
  components/   UI building blocks
  lib/          domain logic and integrations
  bot/          Telegram bot entrypoint
prisma/         schema, migrations, seed
tests/          unit and e2e coverage
docs/           deployment and API notes
```

Source-of-truth files when updating docs:

- `package.json` for scripts and tooling
- `.env.example` and `src/lib/env.ts` for environment contract
- `src/app` and `src/app/api` for pages and HTTP surface
- `docker-compose.yml` and `Dockerfile` for deployment behavior

### Quick start

```bash
git clone https://github.com/dontnikolay/platformaai.git
cd platformaai
cp .env.example .env.local
docker compose up -d postgres
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Local PostgreSQL defaults use port `5433`, matching `.env.example`.
If you are creating or editing migrations locally, use `npm run prisma:migrate:dev`;
`npm run prisma:migrate` applies existing migrations in a production-safe way.

### Required environment

Required for app startup:

- `DATABASE_URL`
- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- `OPENROUTER_API_KEY`
- `UNISENDER_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Optional by feature:

- `APP_URL`
- `UNISENDER_SENDER_EMAIL`, `UNISENDER_SENDER_NAME`
- `OPENAI_API_KEY`, `WHISPER_MODEL`, `WHISPER_LANGUAGE`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_LOGIN_BOT_NAME`, `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME`, `NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED`
- `NEXT_PUBLIC_TEMP_ACCESS_ENABLED`, `TEMP_ACCESS_TOKEN`, `TEMP_ACCESS_EMAIL`, `TEMP_ACCESS_ROLE`
- `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_NAME`, `NEXT_PUBLIC_SSO_ENABLED`
- `CRON_SECRET`, `BILLING_REFILL_TOKEN`
- `AUTH_BYPASS`, `AUTH_BYPASS_EMAIL`, `AUTH_BYPASS_ROLE`, `AUTH_BYPASS_BALANCE`
- Audit and moderation flags from `.env.example`

Validation rules are enforced in [`src/lib/env.ts`](src/lib/env.ts).

### Available scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run test:e2e
npm run bot:dev
npm run prisma:generate
npm run prisma:migrate
npm run prisma:migrate:dev
npm run prisma:seed
```

### Main pages

Public entry routes:

- `/login`
- `/pricing`
- `/share/[token]`
- `/invite/accept?token=...`

Authenticated app routes:

- `/`
- `/models`
- `/prompts`
- `/billing`
- `/settings`
- `/profile`
- `/org`
- `/timeline`
- `/events`
- `/audit`
- `/admin`

### Main API groups

- `/api/ai`
- `/api/auth`
- `/api/billing`
- `/api/chats`
- `/api/events`
- `/api/files`
- `/api/internal`
- `/api/me`
- `/api/messages`
- `/api/models`
- `/api/org`
- `/api/prompts`
- `/api/scim`
- `/api/telegram`

### Documentation map

- Deployment: [docs/deployment/self-hosted.md](docs/deployment/self-hosted.md)
- Operations: [docs/deployment/operations.md](docs/deployment/operations.md)
- Docs index: [docs/README.md](docs/README.md)

### Notes

- Current web login UI uses email and password. SSO and Telegram are optional and env-driven.
- Temporary access is optional and only appears when `NEXT_PUBLIC_TEMP_ACCESS_ENABLED=1` and `TEMP_ACCESS_TOKEN` are set.
- The root app route `/` requires a valid session and redirects unauthenticated users to `/login?mode=signin`.
- Private dashboard pages redirect unauthenticated users to `/login?mode=signin`; role-gated pages may still show access-denied states for signed-in users without enough privileges.
- `/api/ai/image` currently describes uploaded images; it is not a general image generation endpoint.
- Internal protected endpoints use the `x-cron-secret` header when `CRON_SECRET` is configured.

---

<a id="русский"></a>

## Русский

PlatformaAI — это мультимодельное AI-приложение на Next.js 15. В нём объединены чат, работа с файлами, веб-поиск, биллинг, организационные политики и опциональные Telegram/SSO-сценарии доступа.

### Что есть в продукте

- Единый чат с выбором моделей через OpenRouter
- Загрузка файлов с извлечением текста из PDF, DOCX, CSV, TXT и изображений
- Опциональное веб-поисковое обогащение запроса в чате
- Режим описания загруженных изображений через `/api/ai/image`
- Страницы промптов, моделей, биллинга, тарифов, настроек, профиля, организации, ленты, событий, аудита и админки
- Организационные возможности: приглашения, RBAC, cost centers, model policy, DLP policy, SCIM tokens
- Telegram-бот и привязка Telegram-аккаунта
- Биллинг и пополнение через Stripe

### Стек

| Слой | Технология |
| --- | --- |
| App | Next.js 15 App Router, React 19, TypeScript |
| Стили | Tailwind CSS 4 |
| Auth | Auth.js / NextAuth v5 beta, credentials, опциональные SSO и Telegram |
| База | PostgreSQL, Prisma |
| AI | OpenRouter |
| Платежи | Stripe |
| Бот | Telegraf |
| Тесты | Vitest, Playwright |

### Структура репозитория

```text
src/
  app/          страницы Next.js и route handlers
  components/   UI-компоненты
  lib/          бизнес-логика и интеграции
  bot/          точка входа Telegram-бота
prisma/         схема, миграции, seed
tests/          unit и e2e тесты
docs/           deployment и API-документация
```

Файлы-источники правды для документации:

- `package.json` для команд и tooling
- `.env.example` и `src/lib/env.ts` для env-контракта
- `src/app` и `src/app/api` для страниц и HTTP surface
- `docker-compose.yml` и `Dockerfile` для deployment-поведения

### Быстрый старт

```bash
git clone https://github.com/dontnikolay/platformaai.git
cd platformaai
cp .env.example .env.local
docker compose up -d postgres
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Локальный PostgreSQL по умолчанию работает на порту `5433`, как и в `.env.example`.
Если вы создаете или меняете миграции локально, используйте `npm run prisma:migrate:dev`;
`npm run prisma:migrate` применяет уже существующие миграции безопасным для production способом.

### Обязательные переменные окружения

Нужны для старта приложения:

- `DATABASE_URL`
- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- `OPENROUTER_API_KEY`
- `UNISENDER_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Опциональны по включаемым функциям:

- `APP_URL`
- `UNISENDER_SENDER_EMAIL`, `UNISENDER_SENDER_NAME`
- `OPENAI_API_KEY`, `WHISPER_MODEL`, `WHISPER_LANGUAGE`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_LOGIN_BOT_NAME`, `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME`, `NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED`
- `NEXT_PUBLIC_TEMP_ACCESS_ENABLED`, `TEMP_ACCESS_TOKEN`, `TEMP_ACCESS_EMAIL`, `TEMP_ACCESS_ROLE`
- `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_NAME`, `NEXT_PUBLIC_SSO_ENABLED`
- `CRON_SECRET`, `BILLING_REFILL_TOKEN`
- `AUTH_BYPASS`, `AUTH_BYPASS_EMAIL`, `AUTH_BYPASS_ROLE`, `AUTH_BYPASS_BALANCE`
- Флаги аудита и moderation из `.env.example`

Правила валидации заданы в [`src/lib/env.ts`](src/lib/env.ts).

### Основные команды

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run test:e2e
npm run bot:dev
npm run prisma:generate
npm run prisma:migrate
npm run prisma:migrate:dev
npm run prisma:seed
```

### Основные страницы

Публичные входные маршруты:

- `/login`
- `/pricing`
- `/share/[token]`
- `/invite/accept?token=...`

Маршруты приложения с обязательной сессией:

- `/`
- `/models`
- `/prompts`
- `/billing`
- `/settings`
- `/profile`
- `/org`
- `/timeline`
- `/events`
- `/audit`
- `/admin`

### Основные API-группы

- `/api/ai`
- `/api/auth`
- `/api/billing`
- `/api/chats`
- `/api/events`
- `/api/files`
- `/api/internal`
- `/api/me`
- `/api/messages`
- `/api/models`
- `/api/org`
- `/api/prompts`
- `/api/scim`
- `/api/telegram`

### Карта документации

- Deployment: [docs/deployment/self-hosted.md](docs/deployment/self-hosted.md)
- Operations: [docs/deployment/operations.md](docs/deployment/operations.md)
- Индекс docs: [docs/README.md](docs/README.md)

### Примечания

- Текущий веб-логин использует email и пароль. SSO и Telegram подключаются через env.
- Temporary access включается только при `NEXT_PUBLIC_TEMP_ACCESS_ENABLED=1` и наличии `TEMP_ACCESS_TOKEN`.
- Корневой маршрут приложения `/` требует активную сессию и редиректит неавторизованных пользователей на `/login?mode=signin`.
- Приватные dashboard-страницы редиректят неавторизованных пользователей на `/login?mode=signin`; role-based страницы могут дополнительно показывать `access denied` уже для вошедшего пользователя без нужных прав.
- `/api/ai/image` сейчас описывает загруженные изображения, а не является общим image generation endpoint.
- Защищённые внутренние endpoints используют заголовок `x-cron-secret`, если задан `CRON_SECRET`.

## License / Лицензия

Private repository.
