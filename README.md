# Family Flow

Мобильное приложение для семей для управления задачами и совместным расписанием.

Проект собран по материалам из:

- `Project seminar/2 module` — требования, UML и ТЗ;
- `Databases` — схема из 7 связанных таблиц;
- `Course project` — исследование рынка, MVP и UX-направление.

## Что внутри

- `apps/mobile` — мобильный клиент на Expo + React Native + Expo Router.
- `apps/server` — API на Fastify + Prisma.
- `packages/contracts` — общие типы между клиентом и сервером.
- `db/sql` — SQL-артефакты под PostgreSQL.
- `docs` — архитектура, БД, API и диаграммы.

## Технологический стек

- Mobile: Expo, React Native, TypeScript, Expo Router, React Query, Zustand
- API: Fastify, Zod, Prisma
- Data: PostgreSQL 16, Prisma schema, Docker Compose
- Architecture: monorepo через npm workspaces

## Почему этот стек

- Expo и React Native дают быстрый кроссплатформенный мобильный MVP под Android/iOS.
- Fastify проще и быстрее для компактного API, чем перегруженный серверный фреймворк.
- Prisma даёт единый источник истины для БД, типов и запросов.
- PostgreSQL соответствует вашим требованиям из ТЗ и учебным требованиям по БД.

## MVP-функции

- Семейная группа и роли `родитель/ребёнок`
- Домашний overview-экран
- Общий календарь
- Задачи с назначением исполнителей
- Общий список покупок
- База данных из 7 связанных таблиц, приведённых к 3НФ

## Быстрый запуск

1. Скопировать `apps/server/.env.example` в `apps/server/.env`.
2. Поднять PostgreSQL:

```bash
docker compose up -d
```

Если контейнер уже существовал с другими учётными данными, пересоздайте его вместе с volume, иначе Postgres сохранит старый пароль:

```bash
docker compose down -v
docker compose up -d
```

3. Установить зависимости:

```bash
npm install
```

4. Сгенерировать Prisma client и применить миграции:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

5. Запустить API:

```bash
npm run dev:server
```

Опционально: запустить фоновые процессы (outbox worker + cron), чтобы работали email-уведомления и напоминания:

```bash
npm run worker:dev --workspace @family-app/server
npm run cron:dev --workspace @family-app/server
```

6. Запустить мобильный клиент:

```bash
npm run dev:mobile
```

## Backend всегда поднят

Для постоянного фонового запуска backend теперь есть Docker Compose сервисы:

- `postgres`
- `api`
- `worker`
- `cron`

Запуск:

```bash
npm run backend:up
```

Полезные команды:

```bash
npm run backend:logs
npm run backend:restart
npm run backend:down
```

Сервисы backend запускаются с `restart: unless-stopped`, поэтому после старта Docker будет поднимать их автоматически после перезапуска Docker Desktop.

Чтобы автозапуск происходил после входа в Windows, можно установить launcher в папку Startup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-backend-autostart.ps1
```

## Android APK без Expo Go

Чтобы поставить приложение на телефон как обычное Android-приложение, используйте installable build через EAS:

1. Проверьте `apps/mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://<IP_ВАШЕГО_КОМПЬЮТЕРА>:4000
```

`localhost` здесь не подойдёт: на телефоне это будет сам телефон, а не ваш компьютер.

2. Запустите backend и базу данных.
3. Выполните вход в Expo:

```bash
npx eas-cli login
```

4. Запустите сборку APK:

```bash
npm run build:mobile:android:preview
```

5. После завершения EAS Build даст ссылку на `.apk`. Этот файл можно скачать на телефон и установить без Expo Go.

Для публикации в Google Play используйте production-профиль:

```bash
npm run build:mobile:android:production
```

## Удалённый backend без ноутбука

Для truly always-on режима добавлен `render.yaml` в корень репозитория. Он описывает удалённый backend-контур в Render:

- `family-app-api` — публичный web service
- `family-app-worker` — фоновый обработчик outbox
- `family-app-cron` — long-running процесс напоминаний
- `family-app-postgres` — managed PostgreSQL

Почему именно так:

- free web service у Render засыпает после 15 минут без трафика;
- free план недоступен для background workers;
- free Postgres у Render истекает через 30 дней.

Поэтому для независимого постоянного backend нужен платный минимальный контур.

Деплой:

1. Убедитесь, что `render.yaml` уже запушен в GitHub.
2. Откройте:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/Stepanda1/Family-App
```

3. Подтвердите создание Blueprint.
4. Заполните секреты:

- `JWT_ACCESS_SECRET`
- `MFA_ENCRYPTION_KEY`
- при необходимости `GOOGLE_CLIENT_ID`
- при необходимости `APPLE_CLIENT_ID`

5. После первого деплоя возьмите публичный URL `family-app-api` и пропишите его в `apps/mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=https://<your-render-api>.onrender.com
```

6. После этого пересоберите APK, чтобы мобильное приложение ходило уже в удалённый backend.

## Основные экраны

- `Дом` — ключевые события и срочные дела
- `Календарь` — совместное расписание семьи
- `Списки` — задачи и покупки в одном потоке
- `Семья` — участники и код приглашения

## Документация

- [Архитектура](./docs/architecture.md)
- [База данных](./docs/database.md)
- [API](./docs/api.md)
- [ER-диаграмма](./docs/diagrams/er.mmd)
- [Диаграмма компонентов](./docs/diagrams/components.mmd)
