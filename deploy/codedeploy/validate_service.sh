#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

# /health/ready pings the DB. Fails the deployment if the app never gets there.
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/health/ready"; then
    exit 0
  fi
  sleep 5
done

pm2 logs "/^${APP_NAME}-v/" --lines 50 --nostream || true
exit 1
