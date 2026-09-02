#!/bin/bash -l
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

load_collector_env
validate_collector_env

ARCHIVE="otelcol-contrib_${OTELCOL_VERSION}_linux_amd64.tar.gz"
DOWNLOAD_URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/${ARCHIVE}"
TMP_ARCHIVE="/tmp/${ARCHIVE}"
INSTALL_DIR="${OTELCOL_INSTALL_ROOT}/${OTELCOL_VERSION}"
INSTALL_BIN="${INSTALL_DIR}/otelcol-contrib"

if [[ -x "$INSTALL_BIN" ]]; then
  echo "Collector version ${OTELCOL_VERSION} already installed at ${INSTALL_BIN}; skipping download"
else
  echo "Downloading ${DOWNLOAD_URL}"
  curl -fL "$DOWNLOAD_URL" -o "$TMP_ARCHIVE"

  sudo mkdir -p "$INSTALL_DIR"
  sudo tar -xzf "$TMP_ARCHIVE" -C "$INSTALL_DIR" otelcol-contrib
  sudo chmod +x "$INSTALL_BIN"
fi

sudo ln -sfn "$INSTALL_DIR" "${OTELCOL_INSTALL_ROOT}/current"
sudo chmod +x "${OTELCOL_INSTALL_ROOT}/current/otelcol-contrib"

echo "Collector installed at ${OTELCOL_INSTALL_ROOT}/current/otelcol-contrib"
