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
- Email + Password authentication
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
      internal/           #   Cron jobs, metrics
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

### Local Quick Start

```bash
git clone https://github.com/lenin5558dif/platformaai.git
cd platformaai
cp .env.example .env.local   # fill in required keys
docker compose up -d          # PostgreSQL + pgAdmin
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev                   # http://localhost:3000
```

### Production Bootstrap

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

Use `prisma:seed` only for local/dev bootstrap flows.

Required environment variables:
- `DATABASE_URL` — PostgreSQL connection string
- `AUTH_SECRET` — NextAuth secret
- `OPENROUTER_API_KEY` — OpenRouter API key
- `POSTGRES_PASSWORD` / `PGADMIN_PASSWORD` — Docker passwords

### API Endpoints

| Group | Endpoints | Description |
|-------|-----------|-------------|
| `/api/ai` | chat, image | AI generation with streaming |
| `/api/auth` | nextauth, telegram, revoke-all | Authentication |
| `/api/billing` | spend, refill, summary | Billing |
| `/api/chats` | CRUD, share | Chat management |
| `/api/files` | upload, download | File handling |
| `/api/org` | settings, users, roles, invites, policies, cost-centers | B2B |
| `/api/payments` | stripe checkout, webhook | Payments |
| `/api/scim` | Users, Groups, ServiceProviderConfig | SCIM 2.0 |
| `/api/telegram` | token, webhook, unlink | Telegram |

### Security

- AUTH_BYPASS is automatically disabled in production (`NODE_ENV` guard)
- Keep `AUTH_BYPASS=0` in staging and production-like environments
- Seed script is protected from running in production
- All secrets via environment variables (never in code)
- DLP filtering of PII in AI requests
- Rate limiting on critical endpoints
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
- Email + Password аутентификация
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

### Локальный старт

```bash
git clone https://github.com/lenin5558dif/platformaai.git
cd platformaai
cp .env.example .env.local   # заполните ключи
docker compose up -d          # PostgreSQL + pgAdmin
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev                   # http://localhost:3000
```

### Production bootstrap

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

`prisma:seed` оставляйте только для локального/dev bootstrap.

Обязательные переменные окружения:
- `DATABASE_URL` — подключение к PostgreSQL
- `AUTH_SECRET` — секрет для NextAuth
- `OPENROUTER_API_KEY` — ключ OpenRouter API
- `POSTGRES_PASSWORD` / `PGADMIN_PASSWORD` — пароли для Docker

### API Endpoints

| Группа | Endpoints | Описание |
|--------|-----------|----------|
| `/api/ai` | chat, image | AI генерация с streaming |
| `/api/auth` | nextauth, telegram, revoke-all | Аутентификация |
| `/api/billing` | spend, refill, summary | Биллинг |
| `/api/chats` | CRUD, share | Управление чатами |
| `/api/files` | upload, download | Файлы |
| `/api/org` | settings, users, roles, invites, policies, cost-centers | B2B |
| `/api/payments` | stripe checkout, webhook | Платежи |
| `/api/scim` | Users, Groups, ServiceProviderConfig | SCIM 2.0 |
| `/api/telegram` | token, webhook, unlink | Telegram |

### Безопасность

- AUTH_BYPASS автоматически блокируется в production (`NODE_ENV` guard)
- Держите `AUTH_BYPASS=0` на staging и в production-подобных окружениях
- Seed script защищен от запуска в production
- Все секреты через environment variables (не в коде)
- DLP-фильтрация PII в AI-запросах
- Rate limiting на критических endpoints
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
