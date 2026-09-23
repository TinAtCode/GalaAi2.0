import { readFileSync } from 'fs';
import { join } from 'path';

// Testauszüge sind gegen die offiziellen ISO-20022-Schemata camt.053.001.02
// und .08 geprüft (Platzhalter __…__ ersetzt).
export function camtFixture(version: '02' | '08', values: Record<string, string> = {}) {
  const defaults = {
    AMOUNT1: '100.00',
    AMOUNT2: '50.00',
    NUMBER1: 'R-2026-0001',
    NUMBER2_COMPACT: 'R20260002',
  };
  let xml = readFileSync(join(__dirname, `camt053-v${version}.xml`), 'utf8');
  for (const [key, value] of Object.entries({ ...defaults, ...values }))
    xml = xml.replace(`__${key}__`, value);
  return xml;
}
