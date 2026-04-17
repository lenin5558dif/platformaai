# UI Audit And Responsive Fix Plan

Дата: 2026-04-17

Цель: провести полный аудит пользовательского интерфейса, закрыть основные адаптивные дефекты на mobile/tablet/desktop и вести работы по этапам с прозрачным статусом.

## Контекст

- Проект: `platformaai`
- Текущий проход: полный аудит `chat`, `settings`, `org`, `admin`, общих shell-компонентов и мобильной навигации
- Формат выполнения: мультиагентная схема

## Мультиагентная схема

- [x] Главный агент: общий аудит, план, базовый responsive-shell, интеграция правок, верификация
- [x] Агент `Zeno`: аудит `src/components/chat/ChatApp.tsx` по mobile/tablet/desktop
- [x] Агент `Euler`: аудит `settings/org/admin` и связанных responsive-узких мест

## Найденные зоны риска

- [x] Есть жёсткие контейнеры и `min-width`, ухудшающие mobile-layout в onboarding/settings
- [x] В `chat` есть тяжёлый fixed/sticky shell, которому не хватает мобильной компрессии по отступам и контролам
- [x] В `admin` навигация пока в основном desktop-first и требует mobile-паттерна
- [x] В `org/admin` есть формы и action-строки, которые на узких экранах легко распадаются по высоте и читаемости

## План этапов

- [x] Этап 1. Зафиксировать аудит, проблемные зоны и рабочий план в документации
- [x] Этап 2. Починить базовый responsive-shell: общие отступы, мобильные панели, header/action wrapping
- [x] Этап 3. Починить `chat` под mobile/tablet: sidebar, header, message width, composer, onboarding/alert blocks
- [x] Этап 4. Починить `settings` и onboarding: карточки, summary-блоки, формы, обязательные поля
- [x] Этап 5. Починить `org/admin`: мобильная навигация, формы, таблицы, плотность action-элементов
- [x] Этап 6. Прогнать локальную проверку и обновить итоговый статус

## Выполнение

- [x] Собран первичный аудит по коду и существующим UI-артефактам
- [x] Подготовлен поэтапный план фикса
- [x] Стартован первый этап исправлений
- [ ] После завершения этапов отмечать их чекбоксами в этом файле
- [x] Завершён базовый responsive-shell pass для `AppShell`, `AdminSidebar`, `AdminLayout` и верхнего/нижнего shell в `ChatApp`
- [x] Завершён mobile-pass для `chat`: drawer, header, model trigger, message width, safe-area отступы и touch-friendly controls
- [x] Завершён mobile-pass для `org/admin`: action-кластеры сотрудников, RBAC, лимиты, invites, SSO/SCIM и admin navigation/table readability
- [x] Завершён mobile-pass для `settings/onboarding`: CTA, плотность секций, ширина форм и поведение карточек на узком экране
- [x] Выполнен live smoke-check: `login-mobile`, `login-tablet`, `settings-mobile`, `org-mobile`
- [ ] Следующий проход: полировка оставшихся overlay-узких мест в `chat` и расширенный visual pass для `admin/org`

## Критерии готовности

- [ ] Основные экраны читаемы и управляемы на ширине mobile
- [ ] Нет очевидных горизонтальных переполнений в ключевых пользовательских сценариях
- [ ] CTA и secondary actions не конфликтуют между собой по размерам и порядку
- [ ] Навигация в `chat` и `admin` работает без desktop-only предположений
- [x] После локальной проверки документ обновлён финальным статусом
