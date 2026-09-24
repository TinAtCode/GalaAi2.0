import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Trägt alle Dateien des Builds in den Service Worker ein (public/sw.js):
// er speichert sie bei der Installation, damit auch nachgeladene Seiten ohne
// Netz da sind. Der Cache-Name hängt am Inhalt, eine neue Version ersetzt ihn.
function serviceWorkerPrecache(): Plugin {
  let outDir = 'dist';
  let files: string[] = [];
  return {
    name: 'gartenai-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      files = Object.keys(bundle)
        // .woff nur für sehr alte Browser, die holen sie sich bei Bedarf
        .filter((name) => name.startsWith('assets/') && !name.endsWith('.map') && !name.endsWith('.woff'))
        .map((name) => `/${name}`)
        .sort();
    },
    writeBundle() {
      const path = join(outDir, 'sw.js');
      const source = readFileSync(path, 'utf8');
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const result = source
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(files)};`)
        .replace("const BUILD = 'dev';", `const BUILD = '${version}';`);
      if (result === source) throw new Error('sw.js: Platzhalter PRECACHE/BUILD fehlen');
      writeFileSync(path, result);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerPrecache()],
  server: {
    port: 5173,
  },
});
