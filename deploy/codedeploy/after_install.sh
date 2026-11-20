#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

# The agent copies the bundle as root; hand it to the user the app runs as.
sudo chown -R ec2-user:ec2-user "$APP_DIR"
cd "$APP_DIR"

mv file.env .env
chmod 600 .env
# Keys only, never values: this log ends up in CodeDeploy.
cut -d= -f1 .env

# Prisma reads DATABASE_URL from .env in the project root.
# Not npx: the bundle may not keep node_modules/.bin symlinks intact.
node node_modules/prisma/build/index.js migrate deploy
