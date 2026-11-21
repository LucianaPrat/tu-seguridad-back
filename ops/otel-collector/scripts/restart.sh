#!/bin/bash -l
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

load_collector_env

"$OPS_DIR/scripts/validate-config.sh"
pm2 restart "$COLLECTOR_PM2_NAME" --update-env
pm2 save
