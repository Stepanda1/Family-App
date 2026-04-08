# API

## Базовый URL

`http://localhost:4000`

## Health

### `GET /health`

Проверка, что backend запущен.

## Семья

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

### `GET /api/families/:familyId/calendar`

Возвращает календарные элементы (`itemType = EVENT`).

### `GET /api/families/:familyId/tasks`

Возвращает задачи (`itemType = TASK`).

### `GET /api/families/:familyId/shopping`

Возвращает покупки (`itemType = SHOPPING`).

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
