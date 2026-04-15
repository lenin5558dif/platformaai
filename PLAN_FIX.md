# План фикса

## Выполнено

- [x] Закрыт takeover-путь в `src/app/api/auth/register/route.ts` для существующих email-only аккаунтов.
- [x] Отключён опасный auto-linking SSO по email в `src/lib/auth.ts`.
- [x] Закрыт escalation-путь через `src/app/api/org/users/route.ts` при выдаче `ADMIN`.
- [x] Исправлена per-field авторизация в `src/app/api/org/route.ts`.
- [x] Исправлен fallback при сетевых сбоях в `src/app/api/ai/chat/route.ts`.
- [x] Исправлена финализация streaming-ответа в `src/app/api/ai/chat/route.ts`, чтобы частичные ответы не сохранялись как успешные.
- [x] Ужесточена валидация в `src/app/api/payments/stripe/webhook/route.ts`.
- [x] `src/app/api/telegram/webhook/route.ts` переведён в fail-closed режим, чтобы webhook не терял апдейты молча.
- [x] Устранён race при создании invite в `src/app/api/org/invites/route.ts`.
- [x] Добавлен production-safe script `prisma:migrate:deploy` в `package.json`.
- [x] Обновлён `README.md`, чтобы production bootstrap не вёл на `prisma migrate dev` и `seed`.
- [x] Добавлены и обновлены тесты под исправленные сценарии.

## Повторная проверка

- [x] `npx vitest run tests/auth-register-route.test.ts tests/auth-sso-linking.test.ts tests/org-users-route.test.ts tests/org-route.test.ts tests/org-invites-routes.test.ts tests/quota-abac-gates.test.ts tests/stripe-webhook-route.test.ts tests/telegram-webhook-route.test.ts`
- [x] Результат: `8` test files, `38` tests passed.
- [x] `npx eslint src/app/api/ai/chat/route.ts src/app/api/payments/stripe/webhook/route.ts src/app/api/telegram/webhook/route.ts tests/quota-abac-gates.test.ts tests/stripe-webhook-route.test.ts tests/telegram-webhook-route.test.ts`
- [x] Локальный security/release pass по зафиксированным пунктам выполнен повторно после правок.

## Краткое резюме

- Основные production-блокеры из аудита закрыты в пределах текущей ветки `nikofix`.
- Отдельная повторная проверка не выявила регрессий в задетых сценариях.
- Для полноценного релизного решения Telegram webhook всё ещё отключён fail-closed: это безопаснее silent-drop, но для реального webhook-mode позже нужен отдельный handler.
