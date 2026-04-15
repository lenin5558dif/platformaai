# План исправлений

Этот файл ведет пошаговую подготовку ветки `nikolay` к безопасному merge в `main` и к production rollout.

Правило работы:
- каждый завершенный пункт закрывается отдельным коммитом;
- после коммита в этом файле ставится галочка;
- новые агенты ориентируются на этот список и не трогают уже закрытые пункты.

## Merge Blockers

- [x] 1. Закрыть account takeover в `src/app/api/auth/register/route.ts`
- [x] 2. Вернуть brute-force rate limiting в password login (`src/lib/auth.ts`)
- [x] 3. Стабилизировать Telegram auth rollout и не ломать существующий вход
- [x] 4. Вернуть мобильную навигацию в `src/components/layout/AppShell.tsx`
- [x] 5. Выровнять policy доступа к `/admin` в меню и CTA
- [x] 6. Вернуть client-side navigation в `src/components/layout/UserMenu.tsx`
- [x] 7. Убрать dead-end на generic payments routes при YooKassa env
- [x] 8. Сделать production-safe заполнение `BillingPlan`
- [x] 9. Перевести billing UI на `UserSubscription` как source of truth
- [x] 10. Развести денежные subscription transactions и credit ledger
- [x] 11. Починить детерминированное определение плана по `priceId` в webhook

## Release Checks

- [x] A. Прогнать целевые unit/integration тесты по auth
- [x] B. Прогнать целевые unit/integration тесты по billing/payments
- [x] C. Прогнать e2e smoke
- [ ] D. Проверить merge `nikolay -> main` без конфликтов или с заранее разрешенным планом
- [x] E. Проверить deploy/smoke на сервере

## Текущий статус интеграции

- `A` закрыт: `tests/auth.test.ts`, `tests/auth-register-route.test.ts`, `tests/auth-ui.test.ts`, `tests/telegram-token.test.ts` зеленые.
- `B` закрыт: `tests/account-billing-routes.test.ts`, `tests/dashboard-pages.test.ts`, `tests/payments-routes.test.ts`, `tests/stripe-subscription-checkout-route.test.ts`, `tests/stripe-webhook-route.test.ts` зеленые.
- `C` закрыт: после деплоя свежего `nikolay` публичный `E2E_BASE_URL=https://ai.aurmind.ru npm run test:e2e -- tests/e2e/smoke.spec.ts` проходит `9/9`.
- `D` пока заблокирован: прямой `merge --no-commit origin/main` дает большой конфликтный слой.
- `E` закрыт: deploy выполнен на `194.59.40.35`, `3000` и `3001` подняты из `/home/platformaai/releases/nikolay`, публичные `health/readiness` зеленые.
- Основные конфликтные зоны: `.env.example`, `prisma/schema.prisma`, `README.md`, `src/lib/auth.ts`, `src/lib/navigation.ts`, `src/components/auth/*`, `src/components/layout/*`, `src/app/profile/page.tsx`, `src/app/settings/page.tsx`, `src/app/page.tsx`, `src/app/admin/*`, `src/app/api/auth/*`.

## Integration Branch

- [x] Создана интеграционная ветка `codex/integration-main-nikolay` от `origin/main`.
- [x] Выполнен merge `origin/nikolay` в integration worktree `/Users/dontnikolay/Documents/GitHub/platformaai-integration`.
- [x] Разрешены конфликты по группам:
  - `auth / api/auth`
  - `layout / navigation / user menu / app shell`
  - `profile / settings / billing / pricing`
  - `admin / org`
  - `prisma / docs / env`
- [x] Собран гибрид Prisma schema: сохранены subscription/billing модели из `nikolay` и platform/admin/provider модели из `main`.
- [x] Восстановлена совместимость support-lib слоев: `user-settings`, `unisender`, `authorize`, `telegram-linking`, `ai-authorization`, `audit-metrics`, `platform-config`, `provider-credentials`.
- [x] Синхронизированы route/tests контракты для deprecated endpoints и новых flows (`/api/billing/spend`, `/api/org/transfer`, `/api/messages`, `/api/models`, `/api/telegram/webhook`, redirect pages).

## Integration Validation

- [x] `npm run lint`
  - результат: `0 errors`, `2 warnings`
- [x] `npm test`
  - результат: `82 files`, `605 passed`
- [x] `npm run build` c test env
  - команда: `DATABASE_URL=... AUTH_SECRET=... NEXTAUTH_URL=... NEXT_PUBLIC_APP_URL=... OPENROUTER_API_KEY=... UNISENDER_API_KEY=... npm run build`
  - результат: `green`
- [x] `E2E_BASE_URL=https://ai.aurmind.ru npm run test:e2e -- tests/e2e/smoke.spec.ts`
  - результат: `2 passed`, `7 failed`
  - вывод: live domain сейчас не соответствует ожиданиям smoke набора integration branch

## Integration E2E Findings

- `https://ai.aurmind.ru/` редиректит на `/login?mode=register`, а smoke ожидает `/login?mode=signin`.
- `https://ai.aurmind.ru/models`, `/billing`, `/org` остаются доступными как текущие public/live routes, тогда как smoke набор integration branch ожидает redirect на login.
- `pricing` на live домене не содержит ожидаемый heading `/Раскройте потенциал всех LLM/`.
- После browser register/login на live домене smoke не находит heading `Подписка и платежи` на `/billing`.
- Практический вывод: локальный merge-кандидат собран и протестирован, но его поведение не задеплоено на публичный домен, поэтому live Playwright пока валидирует другой runtime.

## Журнал этапов

- [x] Этап 1. Закрыты все кодовые merge-blockers и разнесены по отдельным коммитам.
- [x] Этап 2. Прогнаны целевые auth и billing/payments unit/integration наборы.
- [x] Этап 3. Проверен прямой merge-check с `origin/main`, конфликтный слой зафиксирован.
- [x] Этап 4. Проверен публичный e2e smoke против `https://ai.aurmind.ru`, результаты и расхождения записаны.
- [x] Этап 5. Перепроверен серверный SSH-доступ: обычный `ssh platformaai@194.59.40.35` работает, а прежний `Permission denied (publickey)` был вызван устаревшей инструкцией с неверным ключом в `server.md`.
- [x] Этап 6. Прогнать полный локальный `lint` + `build` + `vitest`.
- [x] Этап 7. Прогнать локальный `Playwright` поверх локального приложения и пройти пользовательские маршруты.
- [x] Этап 8. Свести найденные ошибки в таблицу и определить следующие действия.

## Найденные ошибки и расхождения

- Публичный домен был неактуален до деплоя, но после выкладки свежего `nikolay` публичный `Playwright smoke` проходит `9/9`.
- SSH-доступ к `platformaai@194.59.40.35` работает через обычный `ssh`; прежняя команда из `server.md` с `platformaai_dokploy_ed25519` была неверной.
- Локальный `npm run build` поймал type error в `src/app/billing/page.tsx -> resolvePlanFromSubscription(user?.subscription)`.
- Type error выше исправлен расширением типа `SubscriptionSnapshot` в `src/lib/plans.ts`; после правки нужен повторный `build`.
- Production-like `build` дополнительно выявил хрупкость env-валидации: placeholder `TELEGRAM_BOT_TOKEN=REPLACE_ME` ошибочно включал Telegram auth и валил сборку.
- Type error и env-валидация выше исправлены; после фиксов полный локальный `vitest` прошел (`82 files`, `608 tests`), `lint` зеленый, production-like `build` с `source .env.server && npm run build` тоже зеленый.
- Повторный финальный `vitest` после env-фикса тоже зеленый: `82 files`, `609 tests`.
- Локальный `Playwright smoke` по коду ветки прошел частично: `6 passed`, `3 skipped`. Пропуски штатные, потому что auth roundtrip и share smoke в `tests/e2e/smoke.spec.ts` завязаны на `E2E_BASE_URL`.
- Ручная локальная UI-проверка через Playwright подтвердила:
  - `pricing -> Попробовать бесплатно` ведет на `/login?mode=register`;
  - `pricing -> Выбрать «Креатор»` для неавторизованного пользователя ведет на `/login?mode=signin`;
  - `UserMenu -> Модели` для неавторизованного пользователя ведет на `/login?mode=signin`.
- Ручная локальная UI-проверка выявила UX-пробелы на `pricing`:
  - кнопка `Бизнес (B2B)` декоративная, не меняет состояние страницы;
  - кнопка `Показать полную таблицу` декоративная, не раскрывает сравнение.
- Серверный deploy-check после фиксов:
  - `npm test` на сервере зеленый: `82 files`, `610 tests`;
  - `npm run build` на сервере зеленый;
  - публичные `/api/internal/health` и `/api/internal/readiness` отвечают `ok/ready`.
