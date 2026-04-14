# PlatformaAI

[English](#english) | [Русский](#русский)

---

<a id="english"></a>

## English

**Multi-LLM SaaS platform with unified chat interface, billing, RBAC, and B2B controls.**

A full-featured web application that brings multiple AI models into a single interface with a credit-based payment system, organization management, and a Telegram bot.

### Key Features

**AI Chat**
- Multi-model chat (GPT-4, Claude, Gemini, etc.) via OpenRouter API
- Real-time streaming responses
- File uploads (PDF, DOCX, CSV) with content extraction
- Image generation
- Web search within conversation context
- Shareable chat links

**Billing & Payments**
- Credit-based balance system
- Stripe integration (Checkout, Webhooks)
- Per-token cost tracking with configurable markup
- User and organization-level quotas and limits
- Cost Centers for expense allocation

**Authentication & Authorization**
- Email Magic Link (UniSender)
- Telegram OAuth
- SSO / OIDC for enterprise
- RBAC with custom roles and permissions
- SCIM 2.0 provisioning
- Session management with revocation

**B2B / Enterprise**
- Multi-tenancy (Organizations)
- Invite system with email verification
- DLP policies (PII masking)
- Model policies (restrict available models)
- Audit log with retention and purge
- Analytics and metrics

**Telegram Bot**
- Full AI chat via Telegram
- Voice messages (Whisper STT)
- Link / unlink Telegram to web account
- Shared credit balance

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Next.js 15, React 19, Tailwind CSS 4 |
| Backend | Next.js App Router (API Routes), Server Actions |
| Auth | Auth.js (NextAuth v5), OIDC, SCIM 2.0 |
| Database | PostgreSQL 16, Prisma ORM |
| Payments | Stripe (Checkout, Webhooks) |
| AI | OpenRouter API (GPT-4, Claude, Gemini) |
| Bot | Telegraf (Telegram Bot API) |
| STT | OpenAI Whisper API |
| Email | UniSender API |
| Testing | Vitest (44 unit tests), Playwright (E2E) |
| CI/CD | Docker Compose, GitHub Actions |
| Language | TypeScript (strict mode) |

### Architecture

```
src/
  app/                    # Next.js App Router
    api/                  # 15 API endpoint groups
      ai/                 #   AI chat & image generation
      auth/               #   Authentication & session management
      billing/            #   Credits, spending, refill
      chats/              #   Chat CRUD & sharing
      files/              #   File upload & parsing
      internal/           #   Health, readiness, ops, cron, metrics
      messages/           #   Message CRUD
      models/             #   AI model catalog
      org/                #   Organizations, roles, invites, policies
      payments/           #   Stripe checkout & webhooks
      prompts/            #   Prompt templates
      scim/               #   SCIM 2.0 provisioning
      telegram/           #   Telegram linking
    (14 pages)            # Admin, Billing, Org, Profile, etc.
  components/             # React components
    auth/                 #   Login, SSO, Telegram auth
    billing/              #   Top-up form
    chat/                 #   Chat interface
    layout/               #   App shell, navigation
    org/                  #   RBAC, invites, governance
    profile/              #   Telegram link section
  lib/                    # 58 business logic modules
  bot/                    # Telegram bot
  types/                  # TypeScript declarations
prisma/                   # DB schema (30+ tables) & migrations
tests/                    # 44 unit tests + E2E
docs/                     # API documentation
```

### Quick Start

```bash
git clone https://github.com/lenin5558dif/platformaai.git
cd platformaai
cp .env.example .env.local   # fill in the values for your environment
docker compose up -d postgres # PostgreSQL
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev                   # http://localhost:3000
```

Environment variables are defined in `.env.example` and validated on startup.

For self-hosted/production deployment with the app container and runtime
checks, see [docs/deployment/self-hosted.md](docs/deployment/self-hosted.md).
For backups, restore, rollback, and smoke checks, see
[docs/deployment/operations.md](docs/deployment/operations.md).

Required for a normal local or production launch:
- `DATABASE_URL` — PostgreSQL connection string
- `AUTH_SECRET` — NextAuth secret
- `NEXTAUTH_URL` — canonical app URL for Auth.js and server redirects
- `NEXT_PUBLIC_APP_URL` — public app URL used by the client
- `OPENROUTER_API_KEY` — OpenRouter API key
- `UNISENDER_API_KEY` — UniSender API key for email auth and invites
- `STRIPE_SECRET_KEY` — Stripe secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook secret

Required when the corresponding feature is enabled:
- `UNISENDER_SENDER_EMAIL` — sender address for magic links and invites
- `AUTH_EMAIL_BLOCKLIST` / `AUTH_EMAIL_SUSPICIOUS_DOMAINS` — optional email auth guardrails
- `OPENAI_API_KEY` — Whisper / voice transcription
- `TELEGRAM_BOT_TOKEN` and `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME` — Telegram login / bot
- `TELEGRAM_LOGIN_BOT_NAME` — server-side bot name; must match the public bot name
- `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` — OIDC / SSO
- `NEXT_PUBLIC_SSO_ENABLED` — optional UI toggle for the SSO button (`1` by default)
- `CRON_SECRET` — internal cron endpoints
- `BILLING_REFILL_TOKEN` — refill controller
- `POSTGRES_PASSWORD` / `PGADMIN_PASSWORD` — Docker passwords

Safe defaults are already present in `.env.example` for optional flags such as
`AUTH_BYPASS`, `GLOBAL_ADMIN_EMAILS`, `ALLOW_USER_OPENROUTER_KEYS`, audit retention, moderation, and
telemetry. `AUTH_BYPASS` is blocked by validation in production.

### API Endpoints

| Group | Endpoints | Description |
|-------|-----------|-------------|
| `/api/ai` | chat, image | AI generation with streaming |
| `/api/auth` | nextauth, telegram, revoke-all | Authentication |
| `/api/billing` | spend, refill, summary | Billing |
| `/api/chats` | CRUD, share | Chat management |
| `/api/files` | upload, download | File handling |
| `/api/internal` | health, readiness, ops, cron, metrics | Runtime ops |
| `/api/org` | settings, users, roles, invites, policies, cost-centers | B2B |
| `/api/payments` | stripe checkout, webhook | Payments |
| `/api/scim` | Users, Groups, ServiceProviderConfig | SCIM 2.0 |
| `/api/telegram` | token, webhook, unlink | Telegram |

### Security

- AUTH_BYPASS is automatically disabled in production (`NODE_ENV` guard)
- Seed script is protected from running in production
- All secrets via environment variables (never in code)
- Environment config is validated at startup and fails fast on missing or
  inconsistent URLs/secrets
- DLP filtering of PII in AI requests
- Rate limiting on critical endpoints
- Internal health/readiness are `no-store`; `ops`, `cron`, and `metrics` require `x-cron-secret`
- SCIM token management with rotation
- Audit log for all security events
- Zod validation on all API boundaries

---

<a id="русский"></a>

## Русский

**SaaS-платформа для доступа к нескольким LLM через единый чат-интерфейс с биллингом, RBAC и B2B-контролем.**

Полнофункциональное веб-приложение, объединяющее возможности нескольких AI-моделей в одном интерфейсе с системой оплаты, управлением организациями и Telegram-ботом.

### Ключевые возможности

**AI-чат**
- Мультимодельный чат (GPT-4, Claude, Gemini и др.) через OpenRouter API
- Streaming-ответы в реальном времени
- Загрузка файлов (PDF, DOCX, CSV) с извлечением контента
- Генерация изображений
- Веб-поиск в контексте диалога
- Shared chats по ссылке

**Биллинг и платежи**
- Кредитная система с балансом пользователей
- Интеграция Stripe (Checkout, Webhooks)
- Трекинг расходов по токенам с наценкой
- Квоты и лимиты на уровне пользователей и организаций
- Cost Centers для распределения расходов

**Аутентификация и авторизация**
- Email Magic Link (UniSender)
- Telegram OAuth
- SSO/OIDC для enterprise
- RBAC с кастомными ролями и permissions
- SCIM 2.0 provisioning
- Session management с возможностью отзыва

**B2B / Enterprise**
- Мультитенантность (Organizations)
- Система приглашений с email-верификацией
- DLP-политики (маскирование PII)
- Model policies (ограничение доступных моделей)
- Audit log с retention и purge
- Аналитика и метрики

**Telegram-бот**
- Полноценный чат с AI через Telegram
- Голосовые сообщения (Whisper STT)
- Привязка/отвязка Telegram к веб-аккаунту
- Биллинг через общий баланс

### Технологический стек

| Слой | Технологии |
|------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS 4 |
| Backend | Next.js App Router (API Routes), Server Actions |
| Auth | Auth.js (NextAuth v5), OIDC, SCIM 2.0 |
| Database | PostgreSQL 16, Prisma ORM |
| Payments | Stripe (Checkout, Webhooks) |
| AI | OpenRouter API (GPT-4, Claude, Gemini) |
| Bot | Telegraf (Telegram Bot API) |
| STT | OpenAI Whisper API |
| Email | UniSender API |
| Testing | Vitest (44 unit-теста), Playwright (E2E) |
| CI/CD | Docker Compose, GitHub Actions |
| Language | TypeScript (strict mode) |

### Архитектура

```
src/
  app/                    # Next.js App Router
    api/                  # 15 групп API endpoints
      ai/                 #   AI чат и генерация изображений
      auth/               #   Аутентификация и сессии
      billing/            #   Кредиты, расходы, пополнение
      chats/              #   CRUD чатов и sharing
      files/              #   Загрузка и парсинг файлов
      internal/           #   Cron jobs, метрики
      messages/           #   CRUD сообщений
      models/             #   Каталог AI-моделей
      org/                #   Организации, роли, приглашения, политики
      payments/           #   Stripe checkout и webhooks
      prompts/            #   Шаблоны промптов
      scim/               #   SCIM 2.0 provisioning
      telegram/           #   Привязка Telegram
    (14 страниц)          # Admin, Billing, Org, Profile и др.
  components/             # React компоненты
    auth/                 #   Логин, SSO, Telegram auth
    billing/              #   Форма пополнения
    chat/                 #   Чат-интерфейс
    layout/               #   App shell, навигация
    org/                  #   RBAC, приглашения, governance
    profile/              #   Привязка Telegram
  lib/                    # 58 модулей бизнес-логики
  bot/                    # Telegram бот
  types/                  # TypeScript типы
prisma/                   # Схема БД (30+ таблиц) и миграции
tests/                    # 44 unit-теста + E2E
docs/                     # Документация API
```

### Быстрый старт

```bash
git clone https://github.com/lenin5558dif/platformaai.git
cd platformaai
cp .env.example .env.local   # заполните значения под своё окружение
docker compose up -d postgres # PostgreSQL
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev                   # http://localhost:3000
```

Переменные окружения описаны в `.env.example` и проверяются при старте.

Для self-hosted/production deployment с app-контейнером и runtime-проверками
см. [docs/deployment/self-hosted.md](docs/deployment/self-hosted.md).
Для backup/restore, rollback и post-deploy smoke checks см.
[docs/deployment/operations.md](docs/deployment/operations.md).

Обязательные для обычного локального или production-запуска:
- `DATABASE_URL` — строка подключения к PostgreSQL
- `AUTH_SECRET` — секрет NextAuth
- `NEXTAUTH_URL` — канонический URL приложения для Auth.js и серверных редиректов
- `NEXT_PUBLIC_APP_URL` — публичный URL приложения для клиента
- `OPENROUTER_API_KEY` — ключ OpenRouter
- `UNISENDER_API_KEY` — ключ UniSender для email-авторизации и приглашений
- `STRIPE_SECRET_KEY` — секрет Stripe
- `STRIPE_WEBHOOK_SECRET` — секрет webhook Stripe

Обязательные при включении соответствующей функции:
- `UNISENDER_SENDER_EMAIL` — адрес отправителя для magic link и приглашений
- `AUTH_EMAIL_BLOCKLIST` / `AUTH_EMAIL_SUSPICIOUS_DOMAINS` — опциональные guardrails для email-входа
- `OPENAI_API_KEY` — Whisper / распознавание голоса
- `TELEGRAM_BOT_TOKEN` и `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME` — Telegram login / bot
- `TELEGRAM_LOGIN_BOT_NAME` — server-side имя бота; должно совпадать с публичным именем
- `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` — OIDC / SSO
- `NEXT_PUBLIC_SSO_ENABLED` — опциональный toggle для кнопки SSO (`1` по умолчанию)
- `CRON_SECRET` — внутренние cron endpoints
- `BILLING_REFILL_TOKEN` — refill controller
- `POSTGRES_PASSWORD` / `PGADMIN_PASSWORD` — пароли Docker

В `.env.example` уже есть безопасные значения по умолчанию для опциональных
флагов: `AUTH_BYPASS`, `GLOBAL_ADMIN_EMAILS`, `ALLOW_USER_OPENROUTER_KEYS`, retention для audit,
moderation и telemetry. `AUTH_BYPASS` блокируется валидатором в production.

### API Endpoints

| Группа | Endpoints | Описание |
|--------|-----------|----------|
| `/api/ai` | chat, image | AI генерация с streaming |
| `/api/auth` | nextauth, telegram, revoke-all | Аутентификация |
| `/api/billing` | spend, refill, summary | Биллинг |
| `/api/chats` | CRUD, share | Управление чатами |
| `/api/files` | upload, download | Файлы |
| `/api/internal` | health, readiness, ops, cron, metrics | Runtime ops |
| `/api/org` | settings, users, roles, invites, policies, cost-centers | B2B |
| `/api/payments` | stripe checkout, webhook | Платежи |
| `/api/scim` | Users, Groups, ServiceProviderConfig | SCIM 2.0 |
| `/api/telegram` | token, webhook, unlink | Telegram |

### Безопасность

- AUTH_BYPASS автоматически блокируется в production (`NODE_ENV` guard)
- Seed script защищен от запуска в production
- Все секреты через environment variables (не в коде)
- Конфиг окружения валидируется при старте, и запуск падает при пустых или
  несовместимых URL/секретах
- DLP-фильтрация PII в AI-запросах
- Rate limiting на критических endpoints
- Internal health/readiness работают с `no-store`; `ops`, `cron` и `metrics` требуют `x-cron-secret`
- SCIM token management с ротацией
- Audit log для всех security-событий
- Zod-валидация на всех API boundaries

### Тесты

```bash
npm test                      # 44 unit-теста (Vitest)
npx playwright install        # установка браузеров
npm run test:e2e              # E2E тесты (Playwright)
```

---

## License / Лицензия

Private repository.
