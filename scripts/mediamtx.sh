#!/usr/bin/env bash
#
# MediaMTX sidecar control. Starts the media server that turns the recorder's
# RTSP into the HLS the dashboard plays, and diagnoses the wiring when a live
# view refuses to start.
#
# The media server is a separate process from this API. The API only registers
# camera paths with it and authorizes each playlist and segment; it never
# touches a media packet. See docs/decisions/002-hls-live-streaming.md.
#
#   scripts/mediamtx.sh up       start the container, then run every check
#   scripts/mediamtx.sh down     stop and remove it
#   scripts/mediamtx.sh restart  reload docker/mediamtx.yml
#   scripts/mediamtx.sh logs     follow its output
#   scripts/mediamtx.sh check    diagnose without touching the container
#   scripts/mediamtx.sh env      append the missing MEDIAMTX_* keys to .env
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
CONFIG="$ROOT/docker/mediamtx.yml"

API_URL="http://127.0.0.1:3000"
CONTROL_URL="http://127.0.0.1:9997"
HLS_URL="http://127.0.0.1:8888"
# Must match hlsAllowOrigin in docker/mediamtx.yml, or the browser's preflight
# fails and the card falls back to its stored snapshot with nothing logged.
FRONT_ORIGIN="http://localhost:8443"
# Throwaway MediaMTX path the wiring check registers and deletes. Named so it
# cannot collide with a camera id, which is what a real path is called.
PROBE_PATH="mediamtx-sh-probe"

# The keys the API reads. Absent from .env means Joi's default takes over, and
# MEDIAMTX_ENABLED defaults to false — which is the 409 everybody hits first.
readonly REQUIRED_ENV=(
  "MEDIAMTX_ENABLED=true"
  "MEDIAMTX_API_URL=$CONTROL_URL"
  "MEDIAMTX_PUBLIC_URL=$HLS_URL"
  "MEDIAMTX_TIMEOUT_MS=5000"
)

failures=0

pass() { printf '  \033[32mok\033[0m    %s\n' "$1"; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; }
fail() {
  printf '  \033[31mFAIL\033[0m  %s\n' "$1"
  failures=$((failures + 1))
}
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

compose() { docker compose -f "$ROOT/docker-compose.yml" "$@"; }

# The container is on the host network, so "is it up" and "does it answer" are
# separate questions — a config error leaves it running and deaf.
container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' mediamtx 2>/dev/null)" = "true" ]
}

check_prerequisites() {
  section "Prerequisites"

  if ! command -v docker >/dev/null; then
    fail "docker not on PATH"
    return
  fi
  pass "docker present"

  if ! docker compose version >/dev/null 2>&1; then
    fail "docker compose v2 plugin missing (this file is compose-v2 syntax)"
  else
    pass "docker compose v2 present"
  fi

  [ -f "$CONFIG" ] && pass "docker/mediamtx.yml present" || fail "missing $CONFIG"

  # Worth naming, because it is what a VM-backed engine changes: the container
  # cannot reach this API on loopback, and docker-compose.yml routes it through
  # host.docker.internal for exactly that reason.
  local context
  context=$(docker context show 2>/dev/null || echo unknown)
  case "$context" in
  desktop-*) pass "Docker Desktop context ($context) — the engine runs in a VM" ;;
  *) pass "docker context: $context" ;;
  esac
}

check_env() {
  section "API configuration (.env)"

  if [ ! -f "$ENV_FILE" ]; then
    fail ".env not found — cp .env.example .env"
    return
  fi

  local missing=()
  for entry in "${REQUIRED_ENV[@]}"; do
    local key="${entry%%=*}"
    if ! grep -qE "^[[:space:]]*$key=" "$ENV_FILE"; then
      missing+=("$entry")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    fail "missing in .env: ${missing[*]%%=*}"
    printf '        run: scripts/mediamtx.sh env\n'
    return
  fi

  # Present but off is the likelier mistake once the keys exist at all.
  if grep -qE '^[[:space:]]*MEDIAMTX_ENABLED=(true|yes|1)[[:space:]]*$' "$ENV_FILE"; then
    pass "MEDIAMTX_ENABLED is on"
  else
    fail "MEDIAMTX_ENABLED is off — GET /cameras/:id/live answers 409 before any work"
  fi
}

check_container() {
  section "Container"

  if container_running; then
    pass "mediamtx running"
  else
    fail "mediamtx not running — scripts/mediamtx.sh up"
  fi
}

check_control_api() {
  section "Control API ($CONTROL_URL)"

  if curl -fsS -m 3 "$CONTROL_URL/v3/config/global/get" >/dev/null 2>&1; then
    pass "answering — the API can register camera paths"
  else
    fail "no answer — the API's publish call will time out as UPSTREAM_ERROR"
    return
  fi

}

check_hls() {
  section "HLS ($HLS_URL)"

  # 404 on a path that was never registered is the healthy answer; a refused
  # connection is not. curl prints 000 and exits non-zero when it never got a
  # response at all, so the status alone decides — a `|| echo` fallback here
  # would append a second 000 to the one curl already printed.
  local code
  code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$HLS_URL/" 2>/dev/null) || true
  if [ "$code" = "000" ]; then
    fail "port 8888 refused"
    return
  fi
  pass "port 8888 listening (HTTP $code)"

  # hls.js sends the token as an Authorization header, which makes every
  # request non-simple, so the browser preflights. A preflight that does not
  # come back allowing that header kills playback with no error the API sees.
  local allow_origin allow_headers
  allow_origin=$(curl -s -m 3 -X OPTIONS "$HLS_URL/probe/index.m3u8" \
    -H "Origin: $FRONT_ORIGIN" \
    -H 'Access-Control-Request-Method: GET' \
    -H 'Access-Control-Request-Headers: authorization' \
    -D - -o /dev/null 2>/dev/null | grep -i '^access-control-allow-origin:' | tr -d '\r' | cut -d' ' -f2- || true)
  allow_headers=$(curl -s -m 3 -X OPTIONS "$HLS_URL/probe/index.m3u8" \
    -H "Origin: $FRONT_ORIGIN" \
    -H 'Access-Control-Request-Method: GET' \
    -H 'Access-Control-Request-Headers: authorization' \
    -D - -o /dev/null 2>/dev/null | grep -i '^access-control-allow-headers:' | tr -d '\r' | cut -d' ' -f2- || true)

  if [ -z "$allow_origin" ]; then
    fail "preflight returned no Access-Control-Allow-Origin for $FRONT_ORIGIN"
  elif [ "$allow_origin" = "*" ] || [ "$allow_origin" = "$FRONT_ORIGIN" ]; then
    pass "preflight allows origin ($allow_origin)"
  else
    fail "preflight allows '$allow_origin', frontend is on $FRONT_ORIGIN"
  fi

  if printf '%s' "$allow_headers" | grep -qi 'authorization\|\*'; then
    pass "preflight allows the Authorization header"
  else
    fail "preflight does not allow Authorization — hls.js cannot attach the token (got: '${allow_headers:-none}')"
  fi
}

check_api_reachable() {
  section "Authorization hook ($API_URL)"

  if ! curl -fsS -m 3 "$API_URL/health/live" >/dev/null 2>&1; then
    warn "API not running — start it, MediaMTX denies every reader without the hook"
    return
  fi
  pass "API answering /health/live"

  # The hook is @Public() and reads the token from the body. No token means a
  # refusal, and a refusal proves the route exists and is wired.
  local status
  status=$(curl -s -o /dev/null -m 3 -w '%{http_code}' \
    -X POST "$API_URL/api/v1/streaming/authorize" \
    -H 'Content-Type: application/json' \
    -d '{"action":"read","path":"probe","protocol":"hls"}' 2>/dev/null) || true

  case "$status" in
  401) pass "hook reachable from this host, refusing a tokenless reader (401)" ;;
  404) fail "hook returned 404 — is this the right API base path?" ;;
  000) fail "hook unreachable from this host" ;;
  *) warn "hook answered $status, expected 401 for a tokenless probe" ;;
  esac
}

# The one check that exercises every leg the dashboard depends on, in the order
# the dashboard uses them. Nothing here is inferred from configuration files.
check_round_trip() {
  section "End-to-end wiring"

  container_running || {
    warn "skipped — container not running"
    return
  }

  # Leg 1, this API -> Control API. Also the only honest test of
  # `authHTTPExclude`: with `action: api` missing from that list, MediaMTX asks
  # the hook about its own Control API, the hook authorizes nothing but `read`,
  # and this registration comes back denied. That is the failure mode
  # docs/decisions/002 calls out as invisible from the API side.
  local registered
  registered=$(curl -s -o /dev/null -m 5 -w '%{http_code}' \
    -X POST "$CONTROL_URL/v3/config/paths/replace/$PROBE_PATH" \
    -H 'Content-Type: application/json' \
    -d '{"source":"rtsp://127.0.0.1:554/probe","sourceOnDemand":true}' 2>/dev/null) || true

  if [ "$registered" != "200" ]; then
    fail "path registration answered $registered — check authHTTPExclude in docker/mediamtx.yml"
    return
  fi
  pass "path registered over the Control API (authHTTPExclude is correct)"

  # Leg 2, browser -> MediaMTX -> hook. `-L` matters: MediaMTX bounces the first
  # request through a cookie check, and the authorization answer is on the
  # second. No token, so the hook must refuse — a 401 here is MediaMTX proving
  # it reached this API and did what it was told.
  #
  # Authorization runs before the source is touched, so the unreachable RTSP URL
  # above is never dialled.
  local played
  played=$(curl -sL -o /dev/null -m 8 -w '%{http_code}' "$HLS_URL/$PROBE_PATH/index.m3u8" 2>/dev/null) || true

  case "$played" in
  401) pass "MediaMTX called the hook and honoured its refusal (401)" ;;
  200) fail "playlist served without a token — authMethod is not http" ;;
  000) fail "no answer from the HLS endpoint" ;;
  *) fail "playlist answered $played, expected 401 — MediaMTX likely cannot reach $API_URL from the container" ;;
  esac

  curl -s -o /dev/null -m 3 -X DELETE "$CONTROL_URL/v3/config/paths/delete/$PROBE_PATH" 2>/dev/null || true
}

cmd_check() {
  check_prerequisites
  check_env
  check_container
  check_control_api
  check_hls
  check_api_reachable
  check_round_trip

  if [ "$failures" -gt 0 ]; then
    printf '\n\033[31m%d check(s) failed.\033[0m Live view will not play until they pass.\n' "$failures"
    return 1
  fi
  printf '\n\033[32mAll checks passed.\033[0m Hover a camera card in the dashboard.\n'
}

cmd_env() {
  [ -f "$ENV_FILE" ] || {
    echo "No .env — cp .env.example .env first." >&2
    exit 1
  }

  local appended=0
  for entry in "${REQUIRED_ENV[@]}"; do
    local key="${entry%%=*}"
    grep -qE "^[[:space:]]*$key=" "$ENV_FILE" && continue
    if [ "$appended" -eq 0 ]; then
      printf '\n# Live streaming — see docs/decisions/002-hls-live-streaming.md\n' >>"$ENV_FILE"
      appended=1
    fi
    printf '%s\n' "$entry" >>"$ENV_FILE"
    echo "appended $key"
  done

  if [ "$appended" -eq 0 ]; then
    echo "Nothing to append — every MEDIAMTX_* key is already set."
  else
    echo "Restart the API so it reads them."
  fi
}

cmd_up() {
  compose up -d
  # The container reports running before the HLS muxer binds its port.
  for _ in $(seq 20); do
    curl -fsS -m 1 "$CONTROL_URL/v3/config/global/get" >/dev/null 2>&1 && break
    sleep 0.5
  done
  cmd_check
}

case "${1:-check}" in
up) cmd_up ;;
down) compose down ;;
restart)
  compose restart
  cmd_up
  ;;
logs) compose logs -f mediamtx ;;
check) cmd_check ;;
env) cmd_env ;;
*)
  sed -n '3,17p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
  exit 1
  ;;
esac
