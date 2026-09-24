#!/usr/bin/env bash
# Sofort sichern (zusätzlich zur täglichen Sicherung), z.B. vor einem Update
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose -f docker-compose.buero.yml --env-file .env.buero exec -T backup sh /auto-backup.sh now
