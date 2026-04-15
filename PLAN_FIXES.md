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
- [ ] C. Прогнать e2e smoke
- [ ] D. Проверить merge `nikolay -> main` без конфликтов или с заранее разрешенным планом
- [ ] E. Проверить deploy/smoke на сервере

## Текущий статус интеграции

- `A` закрыт: `tests/auth.test.ts`, `tests/auth-register-route.test.ts`, `tests/auth-ui.test.ts`, `tests/telegram-token.test.ts` зеленые.
- `B` закрыт: `tests/account-billing-routes.test.ts`, `tests/dashboard-pages.test.ts`, `tests/payments-routes.test.ts`, `tests/stripe-subscription-checkout-route.test.ts`, `tests/stripe-webhook-route.test.ts` зеленые.
- `C` пока не закрыт: `E2E_BASE_URL=https://ai.aurmind.ru npm run test:e2e -- tests/e2e/smoke.spec.ts` дает `7 failed, 2 passed`.
- Причины по `C`: `/` редиректит на `/login?mode=register` вместо ожидаемого `/login?mode=signin`; `/models` и `/billing` на публичном домене отдают `404`; переходы после browser auth не попадают на актуальную billing-страницу.
- `D` пока заблокирован: прямой `merge --no-commit origin/main` дает большой конфликтный слой.
- `E` пока заблокирован: SSH-доступ по ключу из `server.md` отклоняется сервером (`Permission denied (publickey)`), поэтому выкатить текущий `nikolay` и прогнать server-side smoke не удалось.
- Основные конфликтные зоны: `.env.example`, `prisma/schema.prisma`, `README.md`, `src/lib/auth.ts`, `src/lib/navigation.ts`, `src/components/auth/*`, `src/components/layout/*`, `src/app/profile/page.tsx`, `src/app/settings/page.tsx`, `src/app/page.tsx`, `src/app/admin/*`, `src/app/api/auth/*`.
