import { createServer } from 'http';
import { answer } from '../demo-agent/demo-agent';

// Demo-Agent als kleiner HTTP-Dienst (nur für docker-compose.demo.yml).
// Ohne Schlüssel: er läuft nur im Docker-Netz der Demo, nicht nach außen.
const port = Number(process.env.PORT ?? 8090);
const MAX_BODY = 30 * 1024 * 1024;

createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('GartenAI Demo-Agent');
    return;
  }
  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk;
    if (body.length > MAX_BODY) req.destroy();
  });
  req.on('end', () => {
    try {
      const result = answer(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch {
      res
        .writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'Ungültige Anfrage' }));
    }
  });
}).listen(port, () => console.log(`Demo-Agent auf Port ${port}`));
