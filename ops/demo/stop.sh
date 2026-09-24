#!/usr/bin/env bash
# Demo beenden (die Daten bleiben): ops/demo/stop.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose -f docker-compose.demo.yml --profile https down
