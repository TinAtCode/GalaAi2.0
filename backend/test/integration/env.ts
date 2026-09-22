import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Läuft vor jedem Test-File, bevor AppModule importiert wird.
if (!process.env.DATABASE_URL) {
  throw new Error('Integrationstests brauchen DATABASE_URL (eine eigene Test-Datenbank – sie wird geleert).');
}
process.env.JWT_SECRET ??= 'integration-test-secret';
process.env.LOGIN_RATE_LIMIT ??= '1000';
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'gartenai-int-uploads-'));
