#!/usr/bin/env bash
set -euo pipefail
monzo_repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$monzo_repository/scripts/evolution-docker.sh" compose \
  --env-file "$monzo_repository/.env.evolution" \
  -f "$monzo_repository/compose.evolution.yaml" "$@"
