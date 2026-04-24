# OpenRouter Text Fallback Audit

Дата: 2026-04-24

## Цель

Проверить текущую генерацию текста и понять, как правильно использовать fallback-механизмы OpenRouter, чтобы снизить падения при недоступности моделей, rate limit, downtime и пустых ответах.

## Проверенные источники

- OpenRouter Model Fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- OpenRouter API Reference: https://openrouter.ai/docs/api/reference/overview
- OpenRouter Provider Selection: https://openrouter.ai/docs/guides/routing/provider-selection
- OpenRouter Auto Router: https://openrouter.ai/docs/guides/routing/routers/auto-router
- OpenRouter Free Models Router: https://openrouter.ai/docs/guides/routing/routers/free-models-router

## Что есть в OpenRouter

- `models`: массив моделей в порядке приоритета. OpenRouter сам пробует следующую модель, если текущая модель или провайдер недоступны, rate-limited, отфильтрованы moderation или упали по контексту.
- `route: "fallback"`: автоматический fallback-режим, если fallback-модели не заданы явно.
- `openrouter/auto`: router для выбора подходящей paid-модели по задаче.
- `openrouter/free`: router по доступным бесплатным текстовым моделям.
- `provider`: настройка provider routing, включая allow/ignore, provider order и fallback-поведение на уровне провайдеров.

## Практическая проверка

- `model: "openai/definitely-not-a-real-model"` + `models: ["openrouter/free"]` вернул `400 invalid model ID`.
- `model: "openai/gpt-5-mini"` + `models: ["openrouter/free"]` при отрицательном балансе OpenRouter вернул `402 Insufficient credits`.
- Вывод: OpenRouter fallback полезен для недоступности модели, rate limit, downtime и части provider/moderation/context ошибок, но не заменяет нашу проверку баланса, тарифа и доступности модели до запроса.

## Текущее состояние проекта

- Основной текстовый endpoint: `src/app/api/ai/chat/route.ts`.
- Клиент присылает `model`, `fallbackModels`, `stream`, `messages`, `chatId`, `temperature`, `max_tokens`.
- Для free-тарифа backend проверяет, что основная модель бесплатная, и фильтрует fallback-модели до бесплатных.
- Для paid-тарифа backend резервирует credits по основной модели.
- Сейчас fallback реализован в приложении ручным циклом по `modelsToTry`.
- Ручной fallback срабатывает на fetch exception, `429` и `503`.
- Для пустого non-stream ответа есть отдельная попытка fallback-модели.
- Для stream есть отдельная попытка fallback только если не пришло ни одного chunk и текст пустой.
- Billing и запись сообщения используют `usedModel`, который сейчас контролируется нашим циклом.

## Узкие места

- Ручной fallback покрывает меньше кейсов, чем OpenRouter `models`: не все `4xx/5xx`, context length и moderation fallback обрабатываются одинаково.
- Если OpenRouter сам выберет другую модель через `models`, нужно брать фактическую модель из `response.model`, иначе billing, cache и telemetry могут записать primary model.
- В stream-режиме фактическая модель может быть доступна только в streamed JSON chunks, поэтому её нужно извлекать из chunks при наличии поля `model`.
- Резервирование credits сейчас строится по primary model. При fallback на более дорогую модель есть риск недорезерва и позднего billing failure.
- При fallback на более дешёвую модель hold может быть завышен, но это безопаснее, если commit корректно финализирует итоговую стоимость.
- Cache key сейчас строится по primary model. Если ответ пришёл от fallback-модели, запись делается по final model, но первичный lookup не учитывает fallback-chain как единый маршрут.
- UI/клиент может присылать fallback-модели, но пользователю не видно, какая модель реально ответила.
- Нет отдельной настройки платформы для fallback policy: включено/выключено, список дефолтных fallback-моделей, режим `openrouter/auto`, режим `openrouter/free`.

## Рекомендованная стратегия

1. Оставить наш preflight:
   - auth;
   - rate limit;
   - billing tier;
   - model policy;
   - disabled models;
   - DLP;
   - moderation;
   - credit reservation.

2. Передавать fallback-chain в OpenRouter:
   - primary model оставить в `model`;
   - fallback list передавать в `models`;
   - включать `models` только если после policy/free-tier фильтрации есть fallback-модели.

3. Упростить ручной fallback:
   - убрать цикл повторных OpenRouter-запросов для обычных provider errors;
   - оставить локальный fallback только для fetch timeout/network exception, потому что до OpenRouter запрос мог вообще не дойти;
   - оставить zero-content recovery как отдельную защиту, но сделать её явной и логируемой.

4. Исправить final model tracking:
   - non-stream: брать `data.model ?? usedModel`;
   - stream: обновлять `usedModel`, если chunk содержит `model`;
   - telemetry/cache/billing/message сохранять фактическую модель.

5. Добавить тесты:
   - request body содержит `model` и `models`;
   - fallback-модели фильтруются policy и disabled models;
   - free-тариф отправляет только бесплатные fallback-модели;
   - non-stream сохраняет `data.model` как фактическую модель;
   - stream сохраняет `parsed.model` из chunk как фактическую модель;
   - network exception still tries local fallback once;
   - `402 Insufficient credits` не маскируется fallback-логикой и возвращается как billing/provider error.

## План внедрения

- [x] Этап 1. Подготовить единый payload OpenRouter.
- [x] 1.1. Вынести сборку chat completion body в helper.
- [x] 1.2. Добавить `models` только при наличии fallback-chain.
- [x] 1.3. Сохранить `stream_options.include_usage` только для stream-запросов.
- [x] 1.4. Прогнать targeted tests после этапа.
- [x] Этап 2. Перевести primary provider call на OpenRouter-managed fallback.
- [x] 2.1. Убрать ручной цикл по `modelsToTry` для обычных upstream ошибок.
- [x] 2.2. Оставить локальную retry-попытку только при network/timeout exception.
- [x] 2.3. Сохранить zero-content recovery как отдельный fallback.
- [x] 2.4. Прогнать targeted tests после этапа.
- [x] Этап 3. Исправить фактическую модель ответа.
- [x] 3.1. Non-stream: использовать `data.model ?? usedModel`.
- [x] 3.2. Stream: читать `parsed.model` из SSE chunks.
- [x] 3.3. Применить final model в billing, cache, message и telemetry.
- [x] 3.4. Прогнать targeted tests после этапа.
- [x] Этап 4. Обновить тестовое покрытие.
- [x] 4.1. Проверить payload с `model` и `models`.
- [x] 4.2. Проверить сохранение `data.model` в non-stream.
- [x] 4.3. Проверить сохранение `parsed.model` в stream.
- [x] 4.4. Проверить network/timeout local fallback.
- [x] 4.5. Проверить, что `402` не маскируется fallback-логикой.
- [ ] Этап 5. Финальная проверка и деплой.
- [x] 5.1. Прогнать typecheck.
- [x] 5.2. Прогнать production build.
- [ ] 5.3. Закоммитить и запушить изменения.
- [ ] 5.4. Развернуть на сервере.
- [ ] 5.5. Проверить PM2, домен и свежие логи.
