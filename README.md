# PlatformaAI

SaaS-платформа для доступа к нескольким LLM через единый чат-интерфейс с биллингом и B2B-контролем.

## Стек
- Next.js 15 (App Router, Server Actions)
- Tailwind CSS
- Auth.js (NextAuth v5)
- Prisma + PostgreSQL
- OpenRouter API
- UniSender API
- Docker + Docker Compose

## Быстрый старт

### 1) Переменные окружения
Скопируйте `.env.example` в `.env.local` и заполните ключи (в том числе `NEXTAUTH_SECRET` или `AUTH_SECRET`, Stripe, Telegram и Whisper). Для локального обхода авторизации используйте `AUTH_BYPASS=1`:

```bash
cp .env.example .env.local
```

### 2) Запуск Postgres

```bash
docker compose up -d
```

Postgres слушает `localhost:5433`, pgAdmin доступен на `http://localhost:5050`.

### 3) Prisma

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

### 4) Dev сервер

```bash
npm run dev
```

Откройте `http://localhost:3000`.

### Telegram бот (dev)

```bash
npm run bot:dev
```

### E2E (Playwright)

```bash
npx playwright install
npm run test:e2e
```

### Stripe webhook (dev)

```bash
stripe listen --forward-to http://localhost:3000/api/payments/stripe/webhook
```

## Полезные команды

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm test
npm run test:e2e
```

## Примечания
- Ограничение на отрицательный баланс включается через `prisma/constraints.sql`.
- UI чата соответствует референсу в `screen.png` и исходнику в `code.html`.
- Биллинг: `OPENROUTER_MARKUP` задает наценку, `USD_PER_CREDIT` — стоимость одного кредита в USD.
- Логи событий пишутся в БД, можно отключить через `LOG_EVENTS=0`.
- Голосовые сообщения в Telegram используют Whisper (`OPENAI_API_KEY`, `WHISPER_*`).
- Пользовательские ключи OpenRouter включаются через `ALLOW_USER_OPENROUTER_KEYS=1` и страницу `/settings`.
- Полезные страницы: `/login`, `/profile`, `/org`, `/models`, `/prompts`, `/timeline`, `/events`, `/settings`.
