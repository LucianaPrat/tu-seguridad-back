#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

sudo mkdir -p "$APP_DIR"
sudo chown -R ec2-user:ec2-user "$APP_DIR"
# Dotfiles too: a stale .env must not survive into the next revision.
find "$APP_DIR" -mindepth 1 -delete
