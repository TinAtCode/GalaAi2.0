#!/usr/bin/env bash
# Sicherung zurückspielen: ops/buero/restore.sh backups/buero/20261004-021500
# ERSETZT Datenbank und Dokumente (fragt vorher nach; prüft die Prüfsummen)
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=.env.buero COMPOSE_FILE=docker-compose.buero.yml exec ops/restore.sh "$@"
