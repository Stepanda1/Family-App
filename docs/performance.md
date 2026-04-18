# Performance & Caching

## Что реализовано

- Redis-backed cache store с автоматическим fallback на memory store.
- Read-through cache для hot GET endpoints:
  - `/api/my/families`
  - `/api/families/:familyId/overview`
  - `/api/families/:familyId/settings`
  - `/api/families/:familyId/calendar`
  - `/api/families/:familyId/tasks`
  - `/api/families/:familyId/shopping`
  - `/api/families/:familyId/search/tasks`
- Scope-version invalidation вместо массового удаления ключей.
- Search cache инвалидируется только после завершения indexing handler в outbox worker.

## Cache model

- `user` scope:
  - используется для `/api/my/families`
- `family` scope:
  - используется для overview/settings/planner lists
- `family_search` scope:
  - используется для search endpoint

Ключ строится как:

- `cache:json:{scope}:{version}:{sha1(keyParts)}`

Инвалидация реализована через bump version у scope, а не через scan/delete по Redis.

## Invalidation rules

- Family write endpoints:
  - инвалидируют `family`
  - дополнительно инвалидируют `user` scopes связанных memberships
- Task/planner write endpoints:
  - инвалидируют `family`
- Search:
  - write path не инвалидирует `family_search` сразу
  - сначала outbox worker обновляет `task_search_documents`
  - затем handler инвалидирует `family_search`

Это сохраняет корректный eventual consistency контракт между write-model и search read-model.

## N+1 и hot spots

Для целевых hot endpoints дополнительного N+1 после внедрения кеша и search read-model не осталось:

- `/api/my/families` кешируется на user scope
- overview/settings/planner endpoints кешируются на family scope
- поиск вынесен в отдельную read-model таблицу `task_search_documents`
- FTS использует generated `searchVector` + GIN index

## Benchmark

Команда:

```powershell
npm run benchmark:cache --workspace @family-app/server
```

Что делает сценарий:

- поднимает Fastify app in-process
- берёт первую seeded membership
- меряет cold path после explicit invalidation
- затем меряет warm path
- использует разные `remoteAddress`, чтобы не упираться в rate limiter

Результаты:

- `/api/my/families`: `13.43 ms -> 2.54 ms` (`5.28x`)
- `/api/families/:familyId/overview`: `21.12 ms -> 5.96 ms` (`3.54x`)
- `/api/families/:familyId/settings`: `11.21 ms -> 6.77 ms` (`1.66x`)
- `/api/families/:familyId/calendar`: `11.62 ms -> 6.50 ms` (`1.79x`)
- `/api/families/:familyId/tasks`: `10.89 ms -> 6.50 ms` (`1.68x`)
- `/api/families/:familyId/shopping`: `11.44 ms -> 6.07 ms` (`1.88x`)
- `/api/families/:familyId/search/tasks`: `9.20 ms -> 6.61 ms` (`1.39x`)

Во всех warm runs hit ratio составил `100%`.

## Operational notes

- Если `REDIS_URL` не задан или Redis недоступен, backend работает на in-memory cache.
- Для production нужен Redis, чтобы versioned invalidation работала консистентно между несколькими инстансами.
