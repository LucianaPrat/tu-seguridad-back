#!/bin/bash -l
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

load_collector_env

curl --fail --silent --show-error "http://127.0.0.1:13133/"
echo
warn_unless_app_exports
