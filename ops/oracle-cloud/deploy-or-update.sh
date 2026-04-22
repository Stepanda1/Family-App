#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/family-app}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

cd "$APP_DIR/ops/oracle-cloud"
docker compose -f docker-compose.oracle.yml --env-file .env.oracle up -d --build
