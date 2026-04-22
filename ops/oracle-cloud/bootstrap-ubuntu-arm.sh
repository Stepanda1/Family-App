#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/family-app}"
REPO_URL="${REPO_URL:-https://github.com/Stepanda1/Family-App.git}"
BRANCH="${BRANCH:-main}"

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git ufw

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
sudo systemctl enable docker
sudo systemctl start docker

if [ ! -d "$APP_DIR/.git" ]; then
  sudo git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  sudo git -C "$APP_DIR" fetch origin
  sudo git -C "$APP_DIR" checkout "$BRANCH"
  sudo git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

sudo cp "$APP_DIR/ops/oracle-cloud/.env.oracle.example" "$APP_DIR/ops/oracle-cloud/.env.oracle"
sudo cp "$APP_DIR/ops/oracle-cloud/family-app.service" /etc/systemd/system/family-app.service

sudo ufw allow OpenSSH
sudo ufw allow 4000/tcp
sudo ufw --force enable

echo
echo "Bootstrap complete."
echo "1. Edit $APP_DIR/ops/oracle-cloud/.env.oracle"
echo "2. Then run:"
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable family-app"
echo "   sudo systemctl start family-app"
