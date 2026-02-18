# PlatformaAI

SaaS-платформа для доступа к нескольким LLM через единый чат-интерфейс с биллингом и B2B-контролем.

## Стек
- Next.js 15 (App Router, Server Actions)
- React 19
- Tailwind CSS 4
- Auth.js (NextAuth v5)
- Prisma + PostgreSQL
- OpenRouter API
- Stripe (платежи)
- Telegraf (Telegram бот)
- Docker + Docker Compose

## Быстрый старт

### 1) Переменные окружения

Скопируйте `.env.example` в `.env.local` и заполните **все** обязательные ключи:

```bash
cp .env.example .env.local
```

Обязательные переменные:
- `AUTH_SECRET` — секрет для NextAuth
- `DATABASE_URL` — строка подключения к PostgreSQL
- `OPENROUTER_API_KEY` — ключ OpenRouter API
- `POSTGRES_PASSWORD` — пароль PostgreSQL (для docker-compose)
- `PGADMIN_PASSWORD` — пароль pgAdmin (для docker-compose)

Для **локальной разработки** можно включить обход авторизации: `AUTH_BYPASS=1` (автоматически отключается в production).

### 2) Запуск PostgreSQL

```bash
docker compose up -d
```

PostgreSQL: `localhost:5433`, pgAdmin: `http://localhost:5050`.

### 3) Инициализация базы данных

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

### Тесты

```bash
npm test                # unit-тесты (Vitest)
npx playwright install  # установка браузеров (первый раз)
npm run test:e2e        # E2E тесты (Playwright)
```

### Stripe webhook (dev)

```bash
stripe listen --forward-to http://localhost:3000/api/payments/stripe/webhook
```

## Структура проекта

```
src/
  app/           # Next.js App Router (страницы и API routes)
  components/    # React компоненты
  lib/           # Бизнес-логика, утилиты, интеграции
  bot/           # Telegram бот
  types/         # TypeScript типы
prisma/          # Схема БД и миграции
tests/           # Тесты
```

## Безопасность

- `AUTH_BYPASS` автоматически отключается при `NODE_ENV=production`
- Seed script не запускается в production
- Все секреты хранятся в `.env.local` (не коммитятся в git)
- Docker пароли задаются через переменные окружения

## Рабочий процесс

Подробные инструкции для разработчиков см. в [CONTRIBUTING.md](CONTRIBUTING.md).

- Ветка `main` — стабильная версия
- Ветка `develop` — разработка
- Мерж в `main` только через Pull Request

## Полезные команды

```bash
npm run dev              # dev сервер
npm run build            # production сборка
npm run lint             # линтер
npm test                 # unit-тесты
npm run test:e2e         # E2E тесты
npm run prisma:generate  # генерация Prisma Client
npm run prisma:migrate   # применение миграций
npm run prisma:seed      # заполнение БД тестовыми данными
npm run bot:dev          # Telegram бот (dev)
```

## Примечания

- Ограничение на отрицательный баланс: `prisma/constraints.sql`
- Биллинг: `OPENROUTER_MARKUP` (наценка), `USD_PER_CREDIT` (стоимость кредита)
- Логи событий: отключаются через `LOG_EVENTS=0`
- Голосовые сообщения: Whisper API (`OPENAI_API_KEY`, `WHISPER_*`)
- Пользовательские ключи OpenRouter: `ALLOW_USER_OPENROUTER_KEYS=1` + `/settings`
- Страницы: `/login`, `/profile`, `/org`, `/models`, `/prompts`, `/timeline`, `/events`, `/settings`
