# Архитектура

## Цель архитектуры

Собрать курсовой MVP так, чтобы он:

- соответствовал ТЗ;
- реально масштабировался дальше;
- оставался простым для демонстрации и доработки.

## Выбранная архитектура

Используется клиент-серверная схема:

- мобильный клиент `Expo/React Native`;
- backend API `Fastify`;
- реляционная БД `PostgreSQL`;
- единая модель данных через `Prisma`.

## Почему не выбран более тяжёлый стек

- Для MVP семейного органайзера отдельный enterprise-слой вроде микросервисов избыточен.
- Fastify даёт меньше шаблонного кода, чем NestJS, но сохраняет строгую структуру маршрутов и DTO через Zod.
- Expo быстрее для курсового мобильного проекта, чем нативная Android/iOS-разработка с раздельными кодовыми базами.

## Слои

### Mobile

- `app` — экраны и навигация.
- `src/lib` — API-доступ и тема.
- `src/store` — локальное состояние семьи.
- `src/components` — переиспользуемые UI-блоки.

### Server

- `src/routes` — HTTP endpoints.
- `src/lib/prisma.ts` — доступ к БД.
- `prisma/schema.prisma` — доменная модель и типы.

### Data

- `db/sql/schema.sql` — SQL-реализация под PostgreSQL.
- `apps/server/prisma/schema.prisma` — ORM-модель.
- `apps/server/prisma/seed.ts` — демо-данные.

## Security и tenancy

- Аутентификация построена вокруг access/refresh-token пары с refresh-token rotation и device sessions.
- Поддерживаются email/password, OAuth и optional TOTP MFA.
- Multi-tenant scoping проходит через `familyId` и `FamilyMembership`.
- Авторизация вынесена в capability-based слой (`owner/parent/child/guest`) с ABAC-проверками для task execution.

## Event-driven backend

- Побочные эффекты публикуются через `outbox_events` в рамках той же транзакции, что и write-model изменения.
- Worker забирает сообщения батчами через lease + `FOR UPDATE SKIP LOCKED`.
- Повторы выполняются с exponential backoff, исчерпанные сообщения попадают в DLQ (`DEAD`).
- Cron-процесс отвечает за плановые enqueue-операции вроде task reminders.

## Search и read-models

- Для задач используется отдельная read-model таблица `task_search_documents`.
- Индексация строится асинхронно через outbox-события `task.search.sync`, `task.search.delete`, `task.search.reindex_family`.
- Поиск реализован на PostgreSQL Full-Text Search (`tsvector` + GIN index) без отдельного search-кластера.
- Консистентность между write-model (`tasks`) и search read-model является eventual consistency: HTTP write сначала коммитит транзакцию, затем worker обновляет индекс.
- Массовые изменения справочников (категории, исполнители, участники) триггерят family-wide reindex, чтобы search read-model оставалась согласованной.

## Performance и data path

- Hot GET endpoints переведены на read-through cache с Redis-backed store и fallback на in-memory store.
- Кеширование построено на versioned scopes, без wildcard delete:
  - `user` для `/api/my/families`
  - `family` для overview/settings/planner lists
  - `family_search` для поиска
- Инвалидация точечная:
  - family mutations инвалидируют `family` и связанные `user` scopes
  - task/planner mutations инвалидируют `family`
  - search cache инвалидируется только после обновления `task_search_documents` в outbox worker
- Поиск не зависит от live join-heavy чтения `tasks`, а работает через отдельную read-model и generated `searchVector` + GIN index.
- Это даёт предсказуемый read path и сохраняет eventual consistency между write-model и search index.

## Benchmarks

Прогон `npm run benchmark:cache --workspace @family-app/server` на seeded локальной базе показал:

- `/api/my/families`: `13.43 ms -> 2.54 ms` (`5.28x`)
- `/api/families/:familyId/overview`: `21.12 ms -> 5.96 ms` (`3.54x`)
- `/api/families/:familyId/settings`: `11.21 ms -> 6.77 ms` (`1.66x`)
- `/api/families/:familyId/calendar`: `11.62 ms -> 6.50 ms` (`1.79x`)
- `/api/families/:familyId/tasks`: `10.89 ms -> 6.50 ms` (`1.68x`)
- `/api/families/:familyId/shopping`: `11.44 ms -> 6.07 ms` (`1.88x`)
- `/api/families/:familyId/search/tasks`: `9.20 ms -> 6.61 ms` (`1.39x`)

- На warm path hit ratio составил `100%` для всех замеренных endpoints.
- Benchmark использует разные `remoteAddress`, чтобы не упираться в rate limiting и мерить именно cache/read path.

## Observability

- HTTP и background execution логируются в JSON.
- В request context пробрасываются `requestId`, `correlationId`, `traceId`, `spanId`.
- API публикует `/health`, `/health/live`, `/health/ready`, `/metrics`.
- Метрики покрывают RED для HTTP, background jobs, runtime saturation и состояние outbox/readiness.
- Для трассировки предусмотрен optional OpenTelemetry bootstrap с OTLP exporter.

## Главные архитектурные решения

### 1. Единая сущность `tasks`

Чтобы сохранить ровно 7 таблиц и не размножать почти одинаковые структуры, календарные события, задачи и покупки хранятся в одной таблице `tasks`.

Разделение идёт через `item_type`:

- `EVENT`
- `TASK`
- `SHOPPING`

### 2. Исполнители выделены отдельно

`executors` позволяет назначать не только членов семьи, но и внешних исполнителей:

- няня;
- репетитор;
- курьер;
- клининг.

При этом внутренний исполнитель может быть связан с записью `participant`.

### 3. История выполнения не смешана с задачей

`task_executions` хранит факт выполнения отдельно от `tasks`, поэтому:

- не теряется история;
- можно строить аналитику;
- модель остаётся в 3НФ.

### 4. Клиент устойчив к отсутствию API

В мобильном клиенте предусмотрен fallback на mock-данные. Это полезно для:

- ранней демонстрации интерфейса;
- курсовой защиты;
- параллельной разработки клиента и сервера.

## Дальнейшее развитие

Следующий шаг после MVP:

- JWT-аутентификация;
- offline-first слой на SQLite в клиенте;
- push-уведомления через Expo Notifications;
- WebSocket/Realtime-синхронизация;
- QR-приглашения в семью;
- интеграция с внешними календарями;
- вынесение read-heavy search/caching слоёв в отдельные сервисы при росте нагрузки.
