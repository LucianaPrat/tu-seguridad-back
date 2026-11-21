# Sourced by every hook. The EC2 is shared with face-api, so every name here
# must stay disjoint from face-api's (`face-auth-app-v*`, port 3000).
APP_NAME=tu-seguridad-api
APP_DIR=/home/ec2-user/apps/tu-seguridad/app
APP_PORT=3001

# Hooks run in a non-interactive shell: node and pm2 only exist after nvm.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
