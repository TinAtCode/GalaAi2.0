#!/usr/bin/env bash
# Prüft E-Rechnungen (XRechnung 3.0, CII) gegen
#   1. das XML-Schema UN/CEFACT CII D16B,
#   2. die Geschäftsregeln der EN 16931 (CEN-Schematron),
#   3. die deutschen Regeln der XRechnung (KoSIT-Schematron).
#
# Aufruf: scripts/validate-xrechnung.sh <Verzeichnis mit .xml-Dateien>
# Voraussetzungen: git, xmllint, Node.js. Die Regelwerke werden beim
# ersten Aufruf nach $XRECHNUNG_RULES_DIR (Standard: .xrechnung-rules)
# geladen und die Schematron-Regeln in XSLT übersetzt.
#
# Scheitert, sobald eine Regel mit flag="fatal" verletzt ist. Warnungen
# werden nur ausgegeben. Hinweis: BR-DE-19 (IBAN-Prüfsumme) meldet mit
# SaxonJS fälschlich eine Warnung, weil die 24-stellige Zahl dort nicht
# exakt gerechnet wird; der Java-Validator der KoSIT rechnet exakt.
set -euo pipefail

INPUT_DIR=${1:?Verzeichnis mit XML-Dateien angeben}
RULES=${XRECHNUNG_RULES_DIR:-.xrechnung-rules}
EN16931_TAG=validation-1.3.16
XRECHNUNG_TAG=v2.6.0

mkdir -p "$RULES"
# SaxonJS als XSLT-3-Prozessor; die Schematron-Übersetzung ist tief rekursiv
if [ ! -d "$RULES/node/node_modules/xslt3" ]; then
  npm install --silent --no-save --prefix "$RULES/node" xslt3@2.7.0
fi
XSLT3="node --stack-size=50000 $RULES/node/node_modules/xslt3/xslt3.js"
if [ ! -d "$RULES/en16931" ]; then
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$EN16931_TAG" https://github.com/ConnectingEurope/eInvoicing-EN16931.git "$RULES/en16931"
fi
if [ ! -d "$RULES/xrechnung" ]; then
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$XRECHNUNG_TAG" https://github.com/itplr-kosit/xrechnung-schematron.git "$RULES/xrechnung"
fi
if [ ! -d "$RULES/iso" ]; then
  git -c advice.detachedHead=false clone --quiet --depth 1 --filter=blob:none --sparse https://github.com/Schematron/schematron.git "$RULES/iso"
  git -C "$RULES/iso" sparse-checkout set trunk/schematron/code
fi

XSD="$RULES/en16931/cii/schema/D16B SCRDM (Subset)/uncoupled clm/CII/uncefact/data/standard/CrossIndustryInvoice_100pD16B.xsd"
EN_SEF="$RULES/en16931-cii.sef.json"
XR_SEF="$RULES/xrechnung-cii.sef.json"
ISO="$RULES/iso/trunk/schematron/code"

# Einmal übersetzen (SEF), danach ist jede Prüfung in etwa einer Sekunde fertig
if [ ! -f "$EN_SEF" ]; then
  $XSLT3 -xsl:"$RULES/en16931/cii/xslt/EN16931-CII-validation.xslt" -export:"$EN_SEF" -nogo
fi
if [ ! -f "$XR_SEF" ]; then
  SCH="$RULES/xrechnung/src/validation/schematron/cii/XRechnung-CII-validation.sch"
  $XSLT3 -xsl:"$ISO/iso_dsdl_include.xsl" -s:"$SCH" -o:"$RULES/xr-1.sch"
  $XSLT3 -xsl:"$ISO/iso_abstract_expand.xsl" -s:"$RULES/xr-1.sch" -o:"$RULES/xr-2.sch"
  $XSLT3 -xsl:"$ISO/iso_svrl_for_xslt2.xsl" -s:"$RULES/xr-2.sch" -o:"$RULES/xrechnung-cii.xsl"
  $XSLT3 -xsl:"$RULES/xrechnung-cii.xsl" -export:"$XR_SEF" -nogo
fi

shopt -s nullglob
files=("$INPUT_DIR"/*.xml)
if [ ${#files[@]} -eq 0 ]; then
  echo "Keine XML-Dateien in $INPUT_DIR" >&2
  exit 1
fi

failed=0
for file in "${files[@]}"; do
  echo "== $(basename "$file")"
  if ! xmllint --noout --schema "$XSD" "$file" 2>&1 | sed 's/^/   /'; then
    failed=1
  fi
  for sef in "$EN_SEF" "$XR_SEF"; do
    report=$(mktemp)
    $XSLT3 -xsl:"$sef" -s:"$file" -o:"$report"
    # Jede verletzte Regel: id, flag und Text in einer Zeile
    node -e '
      const svrl = require("fs").readFileSync(process.argv[1], "utf8");
      let fatal = 0;
      for (const m of svrl.matchAll(/<svrl:failed-assert([^>]*)>[\s\S]*?<svrl:text>([\s\S]*?)<\/svrl:text>/g)) {
        const attr = (n) => (m[1].match(new RegExp(n + "=\"([^\"]*)\"")) || [])[1];
        const flag = attr("flag") || "fatal";
        if (flag === "fatal") fatal++;
        console.log(`   ${flag.toUpperCase()} ${attr("id")}: ${m[2].replace(/\s+/g, " ").trim()}`);
      }
      process.exit(fatal > 0 ? 1 : 0);
    ' "$report" || failed=1
    rm -f "$report"
  done
done

if [ $failed -ne 0 ]; then
  echo "E-Rechnung ungültig." >&2
  exit 1
fi
echo "Alle E-Rechnungen gültig."
