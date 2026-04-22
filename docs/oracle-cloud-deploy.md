# Oracle Cloud Always Free VM

Этот сценарий выносит backend на удалённую VM в Oracle Cloud, чтобы он работал независимо от ноутбука.

## Что используется

- Ubuntu на `Ampere A1` Always Free VM
- Docker Engine + Docker Compose
- контейнеры:
  - `postgres`
  - `api`
  - `worker`
  - `cron`

Готовые файлы:

- `ops/oracle-cloud/docker-compose.oracle.yml`
- `ops/oracle-cloud/.env.oracle.example`
- `ops/oracle-cloud/family-app.service`
- `ops/oracle-cloud/bootstrap-ubuntu-arm.sh`
- `ops/oracle-cloud/deploy-or-update.sh`

## 1. Создайте VM в Oracle Cloud

Рекомендуемые параметры:

- Shape: `VM.Standard.A1.Flex`
- OS: `Ubuntu 24.04` или `Ubuntu 22.04`
- Public IPv4: включить
- SSH key: ваш публичный ключ

Официально Oracle даёт Always Free ARM-ресурсы до `4 OCPU / 24 GB RAM`:
https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

## 2. Откройте входящий трафик

В OCI Security List / Network Security Group откройте:

- `22/tcp` для SSH
- `4000/tcp` для API

Если позже поставите reverse proxy и HTTPS, откроете ещё `80/tcp` и `443/tcp`.

## 3. Подключитесь по SSH

```bash
ssh ubuntu@<PUBLIC_IP>
```

Для Oracle Linux пользователь может быть `opc`, для Ubuntu обычно `ubuntu`.

## 4. Выполните bootstrap

```bash
curl -fsSL https://raw.githubusercontent.com/Stepanda1/Family-App/main/ops/oracle-cloud/bootstrap-ubuntu-arm.sh -o bootstrap-ubuntu-arm.sh
chmod +x bootstrap-ubuntu-arm.sh
./bootstrap-ubuntu-arm.sh
```

Скрипт:

- ставит Docker и Compose plugin
- клонирует репозиторий в `/opt/family-app`
- копирует `.env.oracle.example` в `.env.oracle`
- устанавливает systemd unit
- открывает `4000/tcp` через `ufw`

## 5. Заполните продовые переменные

Отредактируйте:

```bash
nano /opt/family-app/ops/oracle-cloud/.env.oracle
```

Минимум замените:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `MFA_ENCRYPTION_KEY`

Если OAuth не используете, `GOOGLE_CLIENT_ID` и `APPLE_CLIENT_ID` можно оставить пустыми.

## 6. Включите автозапуск

```bash
sudo systemctl daemon-reload
sudo systemctl enable family-app
sudo systemctl start family-app
sudo systemctl status family-app
```

## 7. Проверка

```bash
curl http://127.0.0.1:4000/health
curl http://<PUBLIC_IP>:4000/health
docker ps
```

Ожидается ответ:

```json
{"ok":true,"service":"family-app-api","version":"v1"}
```

## 8. Обновление после push

На VM:

```bash
cd /opt/family-app
./ops/oracle-cloud/deploy-or-update.sh
```

## 9. Подключение мобильного приложения

После того как API живёт на VM, укажите в мобильном клиенте:

```bash
EXPO_PUBLIC_API_URL=http://<PUBLIC_IP>:4000
```

Потом пересоберите APK, чтобы приложение ходило в удалённый backend.

## Важно

- В текущем варианте API опубликован по `http`, не `https`.
- Для Android этого достаточно.
- Для iPhone и production-доставки лучше потом поставить домен + Caddy/Nginx + TLS.
