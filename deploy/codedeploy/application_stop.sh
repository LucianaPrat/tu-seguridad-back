#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

# Only this app's processes: face-api and its otel collector share the daemon.
pm2 delete "/^${APP_NAME}-v/" || true
