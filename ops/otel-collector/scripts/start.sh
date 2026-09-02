#!/bin/bash -l
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

load_collector_env

"$OPS_DIR/scripts/validate-config.sh"

if pm2 describe "$COLLECTOR_PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$COLLECTOR_PM2_NAME" --update-env
else
  pm2 start "$OPS_DIR/pm2/ecosystem.config.cjs" --only "$COLLECTOR_PM2_NAME" --update-env
fi

pm2 save
warn_unless_app_exports
