#!/usr/bin/env bash
set -euo pipefail

repo_dir="${VERAFIDES_REPO_DIR:-/var/www/verafides}"
branch="${VERAFIDES_DEPLOY_BRANCH:-main}"
remote="${VERAFIDES_DEPLOY_REMOTE:-origin}"
lock_file="${VERAFIDES_DEPLOY_LOCK:-/tmp/verafides-deploy.lock}"

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "[deploy] another deploy is already running"
  exit 0
fi

cd "$repo_dir"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

git fetch --prune "$remote" "$branch"

local_head="$(git rev-parse HEAD)"
remote_head="$(git rev-parse "$remote/$branch")"

if [ "$local_head" = "$remote_head" ]; then
  echo "[deploy] already up to date: $local_head"
  exit 0
fi

git diff --quiet
git diff --cached --quiet
git merge --ff-only "$remote/$branch"
npm ci
npm run build

echo "[deploy] deployed $remote_head"
