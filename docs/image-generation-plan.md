# Image Generation Plan

Дата ревизии: 2026-04-23

## Цель

Добавить в PlatformaAI полноценную генерацию изображений:

- отдельный раздел-инструмент для генерации изображений;
- галерею созданных изображений пользователя;
- генерацию изображения из обычного текстового чата по пользовательскому запросу;
- общий billing, audit, model policy и OpenRouter-интеграцию без дублирования бизнес-логики.

## Проверенные факты

- OpenRouter поддерживает image generation через Chat Completions и Responses.
- Для поиска моделей нужно использовать Models API с `output_modalities=image`.
- Для генерации через Chat Completions нужно передавать `modalities`.
- Для моделей с текстом и изображением используется `modalities: ["image", "text"]`.
- Для image-only моделей используется `modalities: ["image"]`.
- Ответ приходит в `choices[0].message.images`, обычно как base64 data URL.
- Текущий `/api/ai/image` в проекте не генерирует изображения. Сейчас он описывает загруженное изображение через vision-модель.

Источники:

- OpenRouter Image Generation docs: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- OpenRouter Image Generation server tool docs: https://openrouter.ai/docs/guides/features/server-tools/image-generation
- OpenRouter Models docs: https://openrouter.ai/docs/guides/overview/models

## Текущие бесплатные image-модели OpenRouter

Проверено через:

```bash
GET https://openrouter.ai/api/v1/models?output_modalities=image
```

На момент проверки API вернул 17 image-capable моделей. Из них с `prompt=0` и `completion=0`:

- `sourceful/riverflow-v2-pro`
- `sourceful/riverflow-v2-fast`
- `black-forest-labs/flux.2-klein-4b`
- `bytedance-seed/seedream-4.5`
- `black-forest-labs/flux.2-max`
- `sourceful/riverflow-v2-max-preview`
- `sourceful/riverflow-v2-standard-preview`
- `sourceful/riverflow-v2-fast-preview`
- `black-forest-labs/flux.2-flex`
- `black-forest-labs/flux.2-pro`

Важно: этот список нельзя хардкодить как вечный. Его нужно получать из OpenRouter Models API и кешировать, потому что доступность и цены могут меняться.

## Продуктовое решение

### Отдельный инструмент

Новый пользовательский раздел:

- маршрут: `/images`;
- навигация: добавить пункт `Изображения` рядом с `Чаты` и `Настройки`;
- интерфейс:
  - поле промпта;
  - выбор модели;
  - выбор пропорции;
  - выбор качества/размера, если поддерживается моделью;
  - кнопка `Сгенерировать`;
  - блок результата;
  - галерея прошлых генераций.

### Генерация из чата

В чате пользователь может написать:

- "сгенерируй изображение...";
- "создай картинку...";
- "нарисуй...";
- "generate image...";

Сценарий:

1. Chat UI определяет намерение генерации.
2. Вместо обычного text-completion вызывается общий image-generation endpoint.
3. В чат добавляется сообщение пользователя.
4. В чат добавляется assistant-сообщение с превью изображения и ссылкой на запись в галерее.
5. Эта же генерация появляется в `/images`.

Важно: чат не должен содержать вторую независимую реализацию генерации. Он должен вызывать общий сервис.

## Архитектура

### Новые сущности БД

Добавить модель `ImageGeneration`.

Поля:

- `id`
- `userId`
- `chatId?`
- `messageId?`
- `prompt`
- `revisedPrompt?`
- `modelId`
- `status`: `PENDING | COMPLETED | FAILED`
- `mimeType`
- `storagePath?`
- `publicUrl?`
- `width?`
- `height?`
- `aspectRatio?`
- `imageSize?`
- `cost`
- `tokenCount`
- `providerRequestId?`
- `error?`
- `metadata`
- `createdAt`
- `updatedAt`

Первый релиз хранит файл локально на сервере, как текущие attachments. Позже можно вынести storage в S3-compatible хранилище.

### Новый backend слой

Добавить:

- `src/lib/image-generation.ts` — основная бизнес-логика;
- `src/lib/image-models.ts` — discovery/filtering image-моделей;
- `src/app/api/images/generate/route.ts` — генерация;
- `src/app/api/images/route.ts` — список галереи;
- `src/app/api/images/[id]/route.ts` — детали;
- `src/app/api/images/[id]/file/route.ts` — отдача файла, если нужно не public path.

### OpenRouter request

Базовый payload:

```json
{
  "model": "black-forest-labs/flux.2-klein-4b",
  "messages": [
    {
      "role": "user",
      "content": "Generate an image..."
    }
  ],
  "modalities": ["image"],
  "stream": false,
  "image_config": {
    "aspect_ratio": "1:1",
    "image_size": "1K"
  }
}
```

Для моделей, которые возвращают и текст, и изображение:

```json
{
  "modalities": ["image", "text"]
}
```

### Billing

Правила:

- Free-тариф может использовать только бесплатные image-модели.
- Платные тарифы могут использовать платные image-модели.
- Для платных image-моделей применяется текущая продуктовая наценка `x2`.
- Для бесплатных моделей списание может быть `0`, но generation event всё равно логируется.
- Нужно использовать тот же billing/quota подход, что и чат:
  - preflight;
  - reservation;
  - commit;
  - release on error.

Отдельно учесть, что image-модели могут иметь pricing не только `prompt/completion`, но и `image`. Расчёт должен быть изолирован в helper, а не размазан по route.

### Safety и policy

Перед отправкой в OpenRouter:

- проверить auth;
- проверить активность пользователя;
- проверить тариф;
- применить DLP к prompt;
- проверить platform disabled models;
- проверить org model policy, если пользователь в организации;
- логировать `AI_REQUEST` / `AI_ERROR`.

### UI

Новые компоненты:

- `ImageStudio`
- `ImagePromptForm`
- `ImageModelSelect`
- `ImageGenerationCard`
- `ImageGallery`
- `ChatGeneratedImage`

UI-принцип:

- не смешивать текстовый чат и image studio в один экран;
- в чате показывать только компактный результат;
- подробности, повтор, скачать, открыть — в `/images`.

## Пошаговый план реализации

### Этап 0. Документация и ревью плана

- [x] Проверить OpenRouter image-generation документацию.
- [x] Проверить текущие image-capable модели через OpenRouter Models API.
- [x] Зафиксировать бесплатные модели на дату проверки.
- [x] Проверить текущий код проекта.
- [x] Зафиксировать архитектуру и этапы.
- [x] Провести саморевью документации.

Критерии готовности:

- Документ не обещает функционал, которого нет в OpenRouter.
- Документ явно различает текущий `/api/ai/image` и будущую генерацию.
- Есть реалистичный план тестирования и коммитов.

### Этап 1. Модели данных и storage

Подэтап 1.1. Prisma schema

- [x] Добавить enum `ImageGenerationStatus`.
- [x] Добавить model `ImageGeneration`.
- [x] Связать с `User`, `Chat`, `Message`.
- [x] Создать миграцию.
- [x] Прогнать `prisma generate`.
- [x] Добавить unit-тесты на helper-форматирование статусов, если появятся. Не потребовались: helper не добавлялся.
- [x] Review.
- [x] Commit.

Подэтап 1.2. Storage helper

- [x] Добавить helper сохранения base64 data URL в файл.
- [x] Валидировать mime-type.
- [x] Ограничить размер результата.
- [x] Добавить тесты.
- [x] Review.
- [x] Commit.

Критерии этапа:

- БД готова хранить историю генераций.
- Storage не принимает произвольный опасный путь.
- Старые attachments не сломаны.

### Этап 2. OpenRouter image provider layer

Подэтап 2.1. Discovery image-моделей

- [ ] Добавить `src/lib/image-models.ts`.
- [ ] Получать `/models?output_modalities=image`.
- [ ] Фильтровать бесплатные модели по pricing.
- [ ] Учитывать `output_modalities`.
- [ ] Кешировать результат на короткое время.
- [ ] Добавить unit-тесты.
- [ ] Review.
- [ ] Commit.

Подэтап 2.2. Provider request/response parser

- [ ] Добавить `src/lib/image-generation-provider.ts`.
- [ ] Формировать payload с `modalities`.
- [ ] Поддержать `image_config.aspect_ratio`.
- [ ] Поддержать `image_config.image_size`.
- [ ] Достать `message.images`.
- [ ] Обработать отсутствие images.
- [ ] Добавить тесты на успешный и ошибочный ответ.
- [ ] Review.
- [ ] Commit.

Критерии этапа:

- OpenRouter-зависимость изолирована.
- Нет хардкода одной модели как единственного варианта.
- Бесплатность определяется динамически.

### Этап 3. Backend API генерации

Подэтап 3.1. `POST /api/images/generate`

- [ ] Добавить request schema.
- [ ] Проверить auth.
- [ ] Проверить пользователя и тариф.
- [ ] Применить DLP/model policy.
- [ ] Выполнить billing preflight/reservation.
- [ ] Вызвать provider layer.
- [ ] Сохранить изображение в storage.
- [ ] Создать `ImageGeneration`.
- [ ] Commit/release billing.
- [ ] Добавить API-тесты.
- [ ] Review.
- [ ] Commit.

Подэтап 3.2. Gallery API

- [ ] `GET /api/images` для списка.
- [ ] `GET /api/images/[id]` для деталей.
- [ ] `GET /api/images/[id]/file` или public-serving strategy.
- [ ] Проверить ownership.
- [ ] Добавить тесты.
- [ ] Review.
- [ ] Commit.

Критерии этапа:

- Нельзя увидеть чужое изображение.
- Ошибка OpenRouter не списывает деньги.
- Успешная генерация появляется в БД и storage.

### Этап 4. Отдельный интерфейс `/images`

Подэтап 4.1. Страница и навигация

- [ ] Добавить `/images`.
- [ ] Добавить пункт в пользовательскую навигацию.
- [ ] Не показывать enterprise-шум.
- [ ] Добавить loading/error/success states.
- [ ] Review.
- [ ] Commit.

Подэтап 4.2. Форма генерации

- [ ] Поле промпта.
- [ ] Выбор модели.
- [ ] Выбор aspect ratio.
- [ ] Выбор image size, если доступен.
- [ ] Submit через API.
- [ ] Disabled/loading state.
- [ ] UI-тесты.
- [ ] Review.
- [ ] Commit.

Подэтап 4.3. Галерея

- [ ] Сетка изображений.
- [ ] Карточка с prompt/model/date.
- [ ] Открытие результата.
- [ ] Empty state.
- [ ] Download/open actions.
- [ ] UI-тесты.
- [ ] Review.
- [ ] Commit.

Критерии этапа:

- Пользователь может сгенерировать изображение без чата.
- История видна после обновления страницы.
- На mobile интерфейс не ломается.

### Этап 5. Интеграция с чатом

Подэтап 5.1. Intent detection

- [ ] Добавить helper определения image-intent.
- [ ] Поддержать русские и английские формулировки.
- [ ] Не перехватывать обычные фразы про изображения без команды генерации.
- [ ] Unit-тесты.
- [ ] Review.
- [ ] Commit.

Подэтап 5.2. Chat API integration

- [ ] Добавить image-generation branch в chat flow или отдельный thin endpoint для chat-triggered generation.
- [ ] Сохранять user message.
- [ ] Сохранять assistant message с результатом.
- [ ] Связывать `ImageGeneration` с `chatId/messageId`.
- [ ] Учитывать billing/policy через общий service.
- [ ] API-тесты.
- [ ] Review.
- [ ] Commit.

Подэтап 5.3. Chat UI rendering

- [ ] Показать generated image card в ленте.
- [ ] Показать loading state генерации.
- [ ] Добавить ссылку `Открыть в галерее`.
- [ ] Не ломать обычный streaming text chat.
- [ ] UI-тесты.
- [ ] Review.
- [ ] Commit.

Критерии этапа:

- Пользователь может попросить картинку прямо в чате.
- Обычный текстовый чат продолжает работать.
- Изображение появляется и в чате, и в галерее.

### Этап 6. Админка, мониторинг, эксплуатация

Подэтап 6.1. Admin visibility

- [ ] Добавить статистику image generations в admin summary.
- [ ] Показать количество генераций, ошибки, расходы.
- [ ] Добавить фильтр по пользователю, если не перегружает MVP.
- [ ] Тесты.
- [ ] Review.
- [ ] Commit.

Подэтап 6.2. Operational safety

- [ ] Добавить env/config для default image model.
- [ ] Добавить feature flag `IMAGE_GENERATION_ENABLED`.
- [ ] Добавить disabled model handling.
- [ ] Добавить rate/error logging.
- [ ] Тесты.
- [ ] Review.
- [ ] Commit.

Критерии этапа:

- Админ понимает, сколько изображений генерируется.
- Функцию можно выключить без деплоя кода.
- Ошибки видны в логах/telemetry.

### Этап 7. Финальное тестирование и релиз

- [ ] Unit tests.
- [ ] API tests.
- [ ] Typecheck.
- [ ] Manual smoke локально.
- [ ] Playwright smoke:
  - login;
  - `/images`;
  - generation happy path with mocked provider or safe test provider;
  - gallery;
  - chat-triggered generation.
- [ ] Review всего feature diff.
- [ ] Финальный commit, если после ревью есть правки.
- [ ] Push.
- [ ] Server deploy.
- [ ] Production smoke.

## Правило выполнения

Каждый подэтап делается отдельно:

1. Реализация.
2. Локальные тесты.
3. Саморевью diff.
4. Исправление найденного.
5. Commit.
6. Обновление чекбокса в этом документе.

После закрытия всех подэтапов этапа:

1. Прогон релевантного набора тестов этапа.
2. Саморевью всего этапа.
3. Отдельный stage-level commit только если были правки документации/интеграции.
4. Переход к следующему этапу.

## Риски

- OpenRouter image-модели и pricing могут измениться.
- Бесплатные image-модели могут иметь rate limits или нестабильную доступность.
- Base64 images могут быть крупными, поэтому storage и лимиты обязательны.
- Chat streaming и image generation имеют разные UX-паттерны, нельзя смешивать их без loading state.
- Billing image-моделей может отличаться от text token billing.
- Для production лучше будет перейти с локального filesystem storage на object storage.

## Саморевью документации

Проверено:

- [x] Документ не утверждает, что старый `/api/ai/image` уже генерирует картинки.
- [x] План использует актуальный OpenRouter механизм `output_modalities=image`.
- [x] План учитывает `modalities` и `message.images`.
- [x] Бесплатные модели отмечены как снимок на дату проверки, а не как постоянная гарантия.
- [x] Есть разделение отдельного инструмента `/images` и chat-triggered generation.
- [x] Есть billing, policy, storage, gallery, admin и testing этапы.

Вывод ревью: документация пригодна как рабочий план. Перед реализацией Этапа 1 нужно не менять продуктовую схему шире, чем требуется для `ImageGeneration`.
