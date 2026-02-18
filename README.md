# PlatformaAI

**SaaS-платформа для доступа к нескольким LLM через единый чат-интерфейс с биллингом, RBAC и B2B-контролем.**

Полнофункциональное веб-приложение, объединяющее возможности нескольких AI-моделей в одном интерфейсе с системой оплаты, управлением организациями и Telegram-ботом.

## Ключевые возможности

**AI-чат**
- Мультимодельный чат (GPT-4, Claude, Gemini и др.) через OpenRouter API
- Streaming-ответы в реальном времени
- Загрузка файлов (PDF, DOCX, CSV) с извлечением контента
- Генерация изображений
- Веб-поиск в контексте диалога
- Shared chats по ссылке

**Биллинг и платежи**
- Кредитная система с балансом пользователей
- Интеграция Stripe (Checkout, webhooks)
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

## Технологический стек

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
| Testing | Vitest (44 unit-тестов), Playwright (E2E) |
| DevOps | Docker Compose, GitHub Actions CI |
| Language | TypeScript (strict mode) |

## Архитектура

```
src/
  app/                    # Next.js App Router
    api/                  # 15 групп API endpoints
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
    admin/                # Admin dashboard
    billing/              # Billing page
    org/                  # Organization management
    ...                   # 14 страниц
  components/             # React компоненты
    auth/                 #   Login, SSO, Telegram auth
    billing/              #   Top-up form
    chat/                 #   Chat interface
    layout/               #   App shell, navigation
    org/                  #   SCIM token manager
    profile/              #   Telegram link section
  lib/                    # 58 модулей бизнес-логики
    auth.ts               #   Аутентификация
    billing.ts            #   Биллинг и кредиты
    quota-manager.ts      #   Квоты и лимиты
    org-rbac.ts           #   RBAC система
    audit.ts              #   Audit logging
    dlp.ts                #   Data Loss Prevention
    model-policy.ts       #   Model access policies
    stripe.ts             #   Stripe интеграция
    openrouter.ts         #   OpenRouter API
    ...
  bot/                    # Telegram бот
  types/                  # TypeScript типы
prisma/                   # Схема БД (30+ таблиц) и миграции
tests/                    # 44 unit-теста + E2E
docs/                     # API документация
```

## Быстрый старт

### 1. Клонирование и настройка

```bash
git clone https://github.com/lenin5558dif/platformaai.git
cd platformaai
cp .env.example .env.local
```

Заполните `.env.local`:
- `DATABASE_URL` — подключение к PostgreSQL
- `AUTH_SECRET` — секрет для NextAuth
- `OPENROUTER_API_KEY` — ключ OpenRouter
- `POSTGRES_PASSWORD` / `PGADMIN_PASSWORD` — пароли для Docker

### 2. Запуск

```bash
docker compose up -d          # PostgreSQL + pgAdmin
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev                   # http://localhost:3000
```

### 3. Тесты

```bash
npm test                      # 44 unit-теста (Vitest)
npx playwright install        # установка браузеров
npm run test:e2e              # E2E тесты (Playwright)
```

## API Endpoints

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

## Безопасность

- AUTH_BYPASS автоматически блокируется в production (`NODE_ENV` guard)
- Seed script защищен от запуска в production
- Все секреты через environment variables (не в коде)
- DLP-фильтрация PII в AI-запросах
- Rate limiting на критических endpoints
- SCIM token management с ротацией
- Audit log для всех security-событий
- Zod-валидация на всех API boundaries

## Лицензия

Private repository.
