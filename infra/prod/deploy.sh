#!/bin/sh
# Roll the control plane to a new image tag. Called by the GitHub deploy workflow over SSH,
# or by hand:  sudo /opt/prgd/deploy.sh v1.4.0
set -eu
TAG="${1:-latest}"
cd /opt/prgd
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TAG}/" /etc/prgd/prgd.env
COMPOSE="docker compose --env-file /etc/prgd/prgd.env -f docker-compose.yml"
$COMPOSE pull api worker console www
$COMPOSE run --rm migrate
$COMPOSE run --rm seed
$COMPOSE up -d --remove-orphans
$COMPOSE ps
curl -fsS --retry 10 --retry-delay 3 --retry-all-errors http://127.0.0.1:4000/healthz >/dev/null 2>&1 || \
  docker compose --env-file /etc/prgd/prgd.env exec -T api curl -fsS http://localhost:4000/healthz
echo "deployed ${TAG}"
