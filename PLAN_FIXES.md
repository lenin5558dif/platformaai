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
- [ ] 7. Убрать dead-end на generic payments routes при YooKassa env
- [ ] 8. Сделать production-safe заполнение `BillingPlan`
- [ ] 9. Перевести billing UI на `UserSubscription` как source of truth
- [ ] 10. Развести денежные subscription transactions и credit ledger
- [ ] 11. Починить детерминированное определение плана по `priceId` в webhook

## Release Checks

- [ ] A. Прогнать целевые unit/integration тесты по auth
- [ ] B. Прогнать целевые unit/integration тесты по billing/payments
- [ ] C. Прогнать e2e smoke
- [ ] D. Проверить merge `nikolay -> main` без конфликтов или с заранее разрешенным планом
- [ ] E. Проверить deploy/smoke на сервере
