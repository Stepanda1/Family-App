# Yandex Cloud VM

Этот сценарий поднимает удалённую VM в Yandex Cloud и готовит backend автоматически через cloud-init.

## Что создаётся

- VPC network
- subnet
- security group c `22/tcp` и `4000/tcp`
- VM с public IP

На первой загрузке VM:

- ставится Docker
- клонируется репозиторий
- копируется `/opt/family-app/ops/oracle-cloud/.env.oracle.example` в `.env.oracle`
- устанавливается `family-app.service`

Дальше backend живёт на VM и уже не зависит от ноутбука.

## Требуется от вас

- сервисный аккаунт Yandex Cloud
- JSON key для него
- `cloud_id`
- `folder_id`
- `image_id` Ubuntu
- ваш `ssh public key`

Официальные docs:

- Terraform quickstart:
  https://yandex.cloud/en/docs/terraform/quickstart
- Initial grant:
  https://yandex.cloud/en/docs/getting-started/usage-grant
- Compute pricing:
  https://yandex.cloud/en/docs/compute/pricing

## Быстрый запуск

```bash
cd ops/yandex-cloud/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

После `apply`:

1. Terraform выведет `public_ip`
2. Подключитесь к VM:

```bash
ssh ubuntu@<PUBLIC_IP>
```

3. Заполните секреты:

```bash
sudo nano /opt/family-app/ops/oracle-cloud/.env.oracle
```

4. Запустите сервис:

```bash
sudo systemctl start family-app
sudo systemctl status family-app
```

5. Проверьте:

```bash
curl http://127.0.0.1:4000/health
curl http://<PUBLIC_IP>:4000/health
```

## Что осталось ручным

Я не могу выполнить `terraform apply` сам, пока у меня нет ваших Yandex Cloud credentials и service account key.

Как только вы пришлёте:

- `cloud_id`
- `folder_id`
- путь/содержимое service account key
- `image_id`
- `ssh public key`

я смогу собрать для вас готовый `terraform.tfvars` без ваших ручных правок.
