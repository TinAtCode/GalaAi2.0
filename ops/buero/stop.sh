#!/usr/bin/env bash
# GartenAI im Büro beenden (Daten bleiben erhalten)
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose -f docker-compose.buero.yml --env-file .env.buero --profile demo stop
