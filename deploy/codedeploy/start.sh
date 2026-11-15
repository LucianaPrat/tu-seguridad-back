#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

cd "$APP_DIR"
FULL_NAME="${APP_NAME}-$(cat version.txt)"

# --interpreter pins nvm's node 22, whatever node the pm2 daemon started under.
# The app loads .env itself (ConfigModule), from this working directory.
pm2 start dist/src/main.js --name "$FULL_NAME" --cwd "$APP_DIR" \
  --interpreter "$(command -v node)" --max-memory-restart 512M \
  --time --log-date-format 'YYYY-MM-DD HH:mm:ss'

# Same unit face-api writes (both on node 22), so rerunning it is harmless.
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u ec2-user --hp /home/ec2-user
pm2 save
