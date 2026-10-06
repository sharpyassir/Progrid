#!/bin/sh
# Roll the control plane to a new image tag. Called by the GitHub deploy workflow over SSH,
# or by hand:  sudo /opt/prgd/deploy.sh v1.4.0
# The deploy user's key is forced to this script (authorized_keys `command=`), and the tag then
# arrives in SSH_ORIGINAL_COMMAND. Only image tag characters are accepted: anything else could
# reach the shell or the sed below as root.
set -eu
TAG="${1:-${SSH_ORIGINAL_COMMAND:-latest}}"
case "$TAG" in
  *[!A-Za-z0-9._-]*|"") echo "refusing tag: $TAG" >&2; exit 2 ;;
esac
logger -t prgd-deploy "deploy ${TAG} requested by ${SUDO_USER:-${USER:-unknown}}" 2>/dev/null || true
cd /opt/prgd
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TAG}/" /etc/prgd/prgd.env
COMPOSE="docker compose --env-file /etc/prgd/prgd.env -f docker-compose.yml"
$COMPOSE pull api worker console www ops gateway
$COMPOSE run --rm migrate
$COMPOSE run --rm seed
$COMPOSE up -d --remove-orphans
$COMPOSE ps
curl -fsS --retry 10 --retry-delay 3 --retry-all-errors http://127.0.0.1:4000/healthz >/dev/null 2>&1 || \
  docker compose --env-file /etc/prgd/prgd.env exec -T api curl -fsS http://localhost:4000/healthz
echo "deployed ${TAG}"
