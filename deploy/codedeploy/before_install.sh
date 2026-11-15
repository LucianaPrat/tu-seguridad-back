#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

mkdir -p "$APP_DIR"
# Dotfiles too: a stale .env must not survive into the next revision.
find "$APP_DIR" -mindepth 1 -delete
