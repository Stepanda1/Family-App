# API

## Базовый URL

`http://localhost:4000`

## Health

### `GET /health`

Проверка, что backend запущен.

### `GET /health/live`

Liveness probe для runtime/orchestrator.

### `GET /health/ready`

Readiness probe. Проверяет доступность БД и возвращает `503`, если сервис не готов принимать трафик.

### `GET /metrics`

Prometheus endpoint со следующими группами метрик:

- HTTP RED
- background worker/cron execution
- process/runtime saturation
- outbox/dead-letter backlog
- due reminder backlog

## Аутентификация

API использует `Bearer`-токен (JWT access token) в заголовке:

`Authorization: Bearer <accessToken>`

Access token короткоживущий (по умолчанию `15m`). Обновление происходит через refresh token (`/api/auth/refresh`) с ротацией.

### `POST /api/auth/register`

Регистрация по email/password.

Дополнительно:

- поддерживает `Idempotency-Key`
- ошибки нормализованы в `application/problem+json`

### `POST /api/auth/login`

Логин по email/password. Если включена MFA, без `totp` вернёт `mfaRequired` и `challengeId`.

### `POST /api/auth/refresh`

Обновление пары токенов. Refresh token ротируется на каждый успешный refresh.

### `POST /api/auth/logout`

Инвалидирует текущую сессию (если `sid` в токене отсутствует — инвалидирует все активные сессии пользователя).

### `POST /api/auth/logout-all`

Инвалидирует все активные сессии пользователя.

### `GET /api/auth/me`

Текущий пользователь.

### `GET /api/auth/sessions`

Список device-сессий (userAgent, ipAddress, lastSeenAt, revokeReason).

### `POST /api/auth/sessions/:sessionId/revoke`

Инвалидирует конкретную device-сессию.

### `POST /api/auth/oauth/google`

OAuth-вход по Google. Клиент должен отправить `idToken` (например, полученный на мобильном клиенте).

### `POST /api/auth/oauth/apple`

OAuth-вход по Apple. Клиент должен отправить `idToken`.

### MFA (TOTP)

Опционально, через `otplib`:

- `POST /api/auth/mfa/setup` — создать секрет (шифруется на сервере).
- `POST /api/auth/mfa/enable` — включить MFA по коду.
- `POST /api/auth/mfa/disable` — выключить MFA по password + коду.
- `GET /api/auth/mfa/status` — статус MFA.
- `POST /api/auth/mfa/verify` — завершить MFA-челлендж (выдаёт токены с `mfa=true`).

## Семья

### `GET /api/my/families`

Возвращает список семей пользователя.

Read-through cache:

- scope: `user`
- header: `x-cache: hit | miss`

### `POST /api/families/bootstrap`

Создание семьи и первого родителя.

Пример тела:

```json
{
  "familyName": "Семья Козловых",
  "timezone": "Asia/Yekaterinburg",
  "ownerName": "Степан"
}
```

### `GET /api/families/:familyId`

Возвращает семью и список участников.

### `GET /api/families/:familyId/overview`

Главный dashboard:

- участники;
- срочные дела;
- ближайшие события.

Read-through cache:

- scope: `family`
- header: `x-cache: hit | miss`

### `GET /api/families/:familyId/calendar`

Возвращает календарные элементы (`itemType = EVENT`).

Read-through cache:

- scope: `family`
- header: `x-cache: hit | miss`

### `GET /api/families/:familyId/tasks`

Возвращает задачи (`itemType = TASK`).

Read-through cache:

- scope: `family`
- header: `x-cache: hit | miss`

### `GET /api/families/:familyId/shopping`

Возвращает покупки (`itemType = SHOPPING`).

Read-through cache:

- scope: `family`
- header: `x-cache: hit | miss`

### `GET /api/families/:familyId/settings`

Возвращает настройки семьи и связанные справочники.

Read-through cache:

- scope: `family`
- header: `x-cache: hit | miss`

### `GET /api/families/:familyId/audit`

Аудит-лог действий в семье (кто/что/когда поменял). Поддерживает cursor pagination (`cursor`) и фильтры по actor/entity.

Дополнительные фильтры:

- `actorSessionId`
- `action`
- `correlationId`
- `traceId`
- `from`
- `to`

## Планировщик

### `POST /api/tasks`

Создание задачи, события или пункта покупки.

Поддерживает:

- `itemType`;
- `priority`;
- `scheduledStartAt`;
- `dueAt`;
- `location`;
- `executorIds`.

Дополнительно:

- поддерживает `Idempotency-Key`
- `GET`-ответы получают `ETag`
- `If-None-Match` может вернуть `304`

### `POST /api/tasks/:taskId/executions`

Фиксирует факт выполнения и обновляет статус записи.

Пример тела:

```json
{
  "participantId": "uuid",
  "actualDurationMinutes": 25,
  "status": "SUCCESS",
  "note": "Сделано до ужина"
}
```

## Поиск

### `GET /api/families/:familyId/search/tasks`

Полнотекстовый поиск по задачам семьи поверх отдельной search read-model.

Query-параметры:

- `q` — поисковый запрос для PostgreSQL FTS
- `itemType` — `EVENT | TASK | SHOPPING`
- `status` — `NEW | IN_PROGRESS | DONE | CANCELLED`
- `limit` — размер страницы, по умолчанию `20`, максимум `50`
- `cursor` — cursor-based pagination для следующей страницы

Особенности:

- endpoint требует capability `planner.read`
- сортировка: `rank DESC`, затем `updatedAt DESC`
- ответ возвращает `nextCursor`
- индекс обновляется асинхронно через outbox/worker, поэтому поиск работает в режиме eventual consistency
- read-through cache использует scope `family_search`
- header: `x-cache: hit | miss`

Пример ответа:

```json
{
  "items": [
    {
      "id": "uuid",
      "taskId": "uuid",
      "title": "Купить продукты",
      "itemType": "SHOPPING",
      "status": "NEW",
      "priority": "HIGH",
      "category": "Покупки",
      "listName": "На выходные",
      "location": "Супермаркет",
      "executorNames": ["Мама", "Папа"],
      "updatedAt": "2026-04-17T10:00:00.000Z",
      "rank": 0.874512
    }
  ],
  "nextCursor": "base64url..."
}
```

## Error contract

Ошибки API нормализованы по RFC7807 (`application/problem+json`).

Поля ответа:

- `type`
- `title`
- `status`
- `detail`
- `instance`
- `code`
- `correlationId`
- `traceId`
- `spanId`
- `errors`

## Response headers

Backend выставляет:

- `x-request-id`
- `x-correlation-id`
- `x-api-version`
- `x-trace-id`
- `x-span-id`
- `x-cache`
- `x-ratelimit-limit`
- `x-ratelimit-remaining`
- `x-ratelimit-reset`
