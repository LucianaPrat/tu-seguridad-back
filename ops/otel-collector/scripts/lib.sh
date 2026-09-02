#!/bin/bash -l
#
# Shared helpers for the collector scripts. Deliberately the same shape as the
# face-api collector's lib.sh: one person knowing either one knows both, and a
# fix in one ports across without translation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OPS_DIR="$ROOT_DIR/ops/otel-collector"
DEFAULT_ENV_FILE="$OPS_DIR/.env"
APP_ENV_FILE="$ROOT_DIR/.env"
COLLECTOR_PM2_NAME="tu-seguridad-otel-collector"

collector_env_file() {
  printf '%s\n' "${OTELCOL_ENV_FILE:-$DEFAULT_ENV_FILE}"
}

collector_mode() {
  local value="${OTELCOL_MODE:-prod}"
  printf '%s\n' "${value,,}"
}

validate_collector_mode() {
  local mode
  mode="$(collector_mode)"

  case "$mode" in
    prod|debug|test)
      ;;
    *)
      echo "Invalid OTELCOL_MODE '$mode'. Expected one of: prod, debug, test" >&2
      return 1
      ;;
  esac
}

collector_mode_requires_grafana() {
  case "$(collector_mode)" in
    prod|debug)
      return 0
      ;;
    test)
      return 1
      ;;
    *)
      validate_collector_mode
      return 1
      ;;
  esac
}

collector_config_file() {
  case "$(collector_mode)" in
    test)
      printf '%s/config/collector.test.yaml\n' "$OPS_DIR"
      ;;
    debug)
      printf '%s/config/collector.debug.yaml\n' "$OPS_DIR"
      ;;
    prod)
      printf '%s/config/collector.prod.yaml\n' "$OPS_DIR"
      ;;
    *)
      validate_collector_mode
      return 1
      ;;
  esac
}

load_collector_env() {
  local env_file
  env_file="$(collector_env_file)"

  if [[ ! -f "$env_file" ]]; then
    echo "Collector env file not found: $env_file" >&2
    return 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  export OTELCOL_MODE="$(collector_mode)"
  export OTELCOL_ENV_FILE="$env_file"
}

require_env() {
  local key="$1"

  if [[ -z "${!key:-}" ]]; then
    echo "Missing required environment variable: $key" >&2
    return 1
  fi
}

require_positive_integer() {
  local key="$1"
  local value="${!key:-}"

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "Environment variable $key must be a positive integer, got '$value'" >&2
    return 1
  fi
}

require_file() {
  local path="$1"

  if [[ ! -f "$path" ]]; then
    echo "Required file not found: $path" >&2
    return 1
  fi
}

require_executable() {
  local path="$1"

  if [[ ! -x "$path" ]]; then
    echo "Required executable not found or not executable: $path" >&2
    return 1
  fi
}

# Every check runs before the function answers, so a first-time setup gets the
# whole list of what is missing instead of one variable per attempt — and the
# non-zero return does not depend on the caller having `set -e`.
validate_collector_env() {
  local required_vars=(
    OTELCOL_BIN
    OTELCOL_VERSION
    OTELCOL_INSTALL_ROOT
  )
  local key
  local failures=0

  for key in "${required_vars[@]}"; do
    require_env "$key" || failures=$((failures + 1))
  done

  validate_collector_mode || failures=$((failures + 1))

  if collector_mode_requires_grafana; then
    for key in \
      OTELCOL_DEPLOY_ENV \
      OTELCOL_INSTANCE_NAME \
      OTELCOL_MEMORY_LIMIT_MIB \
      OTELCOL_MEMORY_SPIKE_LIMIT_MIB \
      GRAFANA_CLOUD_OTLP_ENDPOINT \
      GRAFANA_CLOUD_OTLP_AUTH_HEADER; do
      require_env "$key" || failures=$((failures + 1))
    done

    for key in OTELCOL_MEMORY_LIMIT_MIB OTELCOL_MEMORY_SPIKE_LIMIT_MIB; do
      require_positive_integer "$key" || failures=$((failures + 1))
    done
  fi

  [[ "$failures" -eq 0 ]]
}

# The collector receives nothing until the API is told to export. Absent or
# false leaves OTLP off and the traces simply never arrive, which looks exactly
# like a broken collector from the outside.
warn_unless_app_exports() {
  if [[ ! -f "$APP_ENV_FILE" ]]; then
    echo "warn  no $APP_ENV_FILE — set OTEL_ENABLED=true there so the API exports" >&2
    return 0
  fi

  if ! grep -Eq '^[[:space:]]*OTEL_ENABLED[[:space:]]*=[[:space:]]*true' "$APP_ENV_FILE"; then
    echo "warn  OTEL_ENABLED is not true in $APP_ENV_FILE — the API is not exporting" >&2
  fi
}
