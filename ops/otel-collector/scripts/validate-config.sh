#!/bin/bash -l
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

load_collector_env
validate_collector_env
CONFIG_FILE="$(collector_config_file)"
require_executable "$OTELCOL_BIN"
require_file "$CONFIG_FILE"

"$OTELCOL_BIN" validate --config="$CONFIG_FILE"
