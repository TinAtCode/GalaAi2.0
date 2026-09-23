#!/usr/bin/env bash
# Prüft PDFs
#   1. auf PDF/A-3b mit veraPDF, dem Referenz-Validator der PDF Association,
#   2. PDFs mit eingebetteter factur-x.xml zusätzlich als ZUGFeRD-Rechnung
#      mit dem Mustang-Validator (XMP, Anhang, XML gegen EN 16931 und
#      XRechnung).
#
# Aufruf: scripts/validate-pdfa.sh <Verzeichnis mit .pdf-Dateien>
# Voraussetzungen: Java und Maven. Beide Validatoren werden beim ersten
# Aufruf von Maven Central nach $VERAPDF_DIR (Standard: .verapdf) geladen.
#
# Scheitert, sobald eine Datei nicht konform ist.
set -euo pipefail

INPUT_DIR=${1:?Verzeichnis mit PDF-Dateien angeben}
VERAPDF=${VERAPDF_DIR:-.verapdf}
VERSION=1.28.2
MUSTANG_VERSION=2.26.0

if [ ! -d "$VERAPDF/lib" ]; then
  mkdir -p "$VERAPDF"
  cat > "$VERAPDF/pom.xml" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>local</groupId><artifactId>verapdf-cli</artifactId><version>1</version>
  <dependencies>
    <dependency><groupId>org.verapdf.apps</groupId><artifactId>greenfield-apps</artifactId><version>$VERSION</version></dependency>
  </dependencies>
</project>
POM
  mvn -q -f "$VERAPDF/pom.xml" dependency:copy-dependencies -DoutputDirectory=lib
fi
MUSTANG="$VERAPDF/mustang/Mustang-CLI-$MUSTANG_VERSION.jar"
if [ ! -f "$MUSTANG" ]; then
  mvn -q dependency:copy -Dartifact="org.mustangproject:Mustang-CLI:$MUSTANG_VERSION" -DoutputDirectory="$VERAPDF/mustang"
fi

shopt -s nullglob
files=("$INPUT_DIR"/*.pdf)
if [ ${#files[@]} -eq 0 ]; then
  echo "Keine PDF-Dateien in $INPUT_DIR" >&2
  exit 1
fi

report=$(java -cp "$VERAPDF/lib/*" org.verapdf.apps.GreenfieldCliWrapper --flavour 3b --format text "${files[@]}" 2>/dev/null || true)
echo "$report"
passed=$(grep -c '^PASS ' <<<"$report" || true)
if [ "$passed" -ne ${#files[@]} ]; then
  echo "PDF/A-3b: $passed von ${#files[@]} Dateien konform" >&2
  # Details zu den fehlerhaften Dateien
  for f in "${files[@]}"; do
    if ! grep -q "^PASS $f" <<<"$report"; then
      java -cp "$VERAPDF/lib/*" org.verapdf.apps.GreenfieldCliWrapper --flavour 3b --format text -v "$f" 2>/dev/null | head -40 || true
    fi
  done
  exit 1
fi
echo "PDF/A-3b: alle ${#files[@]} Dateien konform"

zugferd=0
for f in "${files[@]}"; do
  grep -aq 'factur-x.xml' "$f" || continue
  zugferd=$((zugferd + 1))
  result=$(java -jar "$MUSTANG" --action validate --no-notices --source "$f" 2>/dev/null || true)
  # Gesamturteil ist die letzte summary-Zeile (PDF, XML, gesamt)
  if [ "$(grep -o '<summary status="[a-z]*"/>' <<<"$result" | tail -1)" != '<summary status="valid"/>' ]; then
    echo "ZUGFeRD ungültig: $f" >&2
    echo "$result" >&2
    exit 1
  fi
  echo "ZUGFeRD gültig: $f"
done
echo "ZUGFeRD: $zugferd Dateien geprüft"
