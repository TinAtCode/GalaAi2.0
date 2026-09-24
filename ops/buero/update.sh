#!/usr/bin/env bash
# Neue Version einspielen: erst sichern, dann holen und neu bauen. Die
# Datenbank wird beim Start des Backends automatisch angepasst (Migrationen).
set -euo pipefail
cd "$(dirname "$0")/../.."
echo "Sichere vor dem Update …"
ops/buero/backup-now.sh
if [ -d .git ]; then
  git pull --ff-only
else
  echo "Kein Git-Ordner: neue Version als ZIP herunterladen und über diesen Ordner entpacken (.env.buero und backups/ bleiben)."
fi
exec ops/buero/start.sh
