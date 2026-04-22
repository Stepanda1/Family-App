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

## Вариант без ручного накликивания VM

Добавлен Terraform-комплект:

- `ops/oracle-cloud/terraform/versions.tf`
- `ops/oracle-cloud/terraform/main.tf`
- `ops/oracle-cloud/terraform/variables.tf`
- `ops/oracle-cloud/terraform/outputs.tf`
- `ops/oracle-cloud/terraform/terraform.tfvars.example`
- `ops/oracle-cloud/terraform/cloud-init.yaml.tftpl`

Он создаёт:

- VCN
- public subnet
- internet gateway
- security list c `22/tcp` и `4000/tcp`
- VM `VM.Standard.A1.Flex`

И на первом boot через cloud-init:

- ставит Docker
- клонирует репозиторий
- копирует `.env.oracle.example` в `.env.oracle`
- устанавливает `family-app.service`

Остаётся только заполнить OCI credentials и выполнить `terraform apply`.

Команды:

```bash
cd ops/oracle-cloud/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

Нужно заполнить в `terraform.tfvars`:

- `tenancy_ocid`
- `compartment_ocid`
- `user_ocid`
- `fingerprint`
- `private_key_path`
- `ssh_public_key`
- `image_ocid`

Почему `image_ocid` вручную:

Oracle рекомендует пинить region-specific image OCID, а не полагаться на динамический поиск через data source:
https://docs.oracle.com/en-us/iaas/Content/terraform/ref-images.htm

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
