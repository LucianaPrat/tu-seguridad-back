#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

cd "$APP_DIR"
FULL_NAME="${APP_NAME}-$(cat version.txt)"

# ApplicationStop runs the previous revision's script and swallows its errors, and
# on 2026-11-21 it left the old release running: it kept port 3001, answered the
# health check, and served stale code. Delete every earlier release here by id,
# from pm2's own JSON, so nothing depends on that hook or on pm2 name regexes.
for id in $(pm2 jlist | node -e '
  const prefix = process.argv[1] + "-v";
  let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
    for (const p of JSON.parse(raw)) if (p.name.startsWith(prefix)) console.log(p.pm_id);
  });' "$APP_NAME"); do
  pm2 delete "$id"
done

# --interpreter pins nvm's node 22, whatever node the pm2 daemon started under.
# The app loads .env itself (ConfigModule), from this working directory.
pm2 start dist/src/main.js --name "$FULL_NAME" --cwd "$APP_DIR" \
  --interpreter "$(command -v node)" --max-memory-restart 512M \
  --time --log-date-format 'YYYY-MM-DD HH:mm:ss'

# Same unit face-api writes (both on node 22), so rerunning it is harmless.
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u ec2-user --hp /home/ec2-user
pm2 save
