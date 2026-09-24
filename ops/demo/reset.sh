#!/usr/bin/env bash
# Demo auf den Anfangszustand zurücksetzen (alle Änderungen weg, frische
# Beispieldaten) und neu starten: ops/demo/reset.sh [--https]
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose -f docker-compose.demo.yml --profile https down -v
exec ops/demo/start.sh "$@"
