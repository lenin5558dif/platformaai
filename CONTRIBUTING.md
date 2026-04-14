# Инструкция для разработчиков

## Рабочий процесс

**НИКОГДА не пушьте напрямую в ветку `main`!**

Вся разработка ведется только в ветке `develop`.

## Начало работы

### 1. Клонируйте репозиторий и переключитесь на develop:

```bash
git clone https://github.com/lenin5558dif/platformaai.git
cd platformaai
git checkout develop
```

### 2. Настройте окружение:

```bash
cp .env.example .env.local
```

Заполните `.env.local` необходимыми ключами. Обязательные:
- `POSTGRES_PASSWORD` — пароль для PostgreSQL
- `PGADMIN_PASSWORD` — пароль для pgAdmin
- `AUTH_SECRET` — секрет для авторизации
- `DATABASE_URL` — строка подключения к БД

Для локальной разработки добавьте `AUTH_BYPASS=1` для обхода авторизации.

### 3. Запустите инфраструктуру и проект:

```bash
docker compose up -d
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Приложение доступно на `http://localhost:3000`.

## Ежедневная работа

### 1. Перед началом работы — получите последние изменения:
```bash
git checkout develop
git pull origin develop
```

### 2. Вносите изменения в код

### 3. Коммитьте и пушьте ТОЛЬКО в develop:
```bash
git add .
git commit -m "Описание ваших изменений"
git push origin develop
```

### 4. Когда нужно влить изменения в main:
- Создайте Pull Request на GitHub из ветки `develop` в `main`
- Напишите владельцу репозитория для ревью
- После одобрения владелец сольет PR

## Правила работы с ветками

### НЕ делайте так:
```bash
git checkout main          # не переключайтесь на main
git push origin main       # не пушьте в main
git merge develop          # не мержите в main самостоятельно
```

### Правильно:
```bash
git checkout develop       # всегда работайте в develop
git push origin develop    # пушьте только в develop
# для мержа в main — создайте Pull Request на GitHub
```

## Безопасность

- **Не коммитьте** файлы `.env`, `.env.local` и любые файлы с секретами
- **Не добавляйте** API ключи, пароли и токены в код — используйте `process.env`
- **Проверяйте** `git diff` перед коммитом на наличие случайных секретов

## Структура веток

- `main` — стабильная версия (только через Pull Request)
- `develop` — разработка (для всех разработчиков)

## Тесты

Перед пушем рекомендуется запускать тесты:

```bash
npm test          # unit-тесты
npm run lint      # линтер
```

## Вопросы?

Если возникли вопросы — свяжитесь с владельцем репозитория.
