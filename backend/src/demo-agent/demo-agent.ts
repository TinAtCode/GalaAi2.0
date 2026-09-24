// Demo-Agent für Vorführungen: beantwortet alle KI-Aufgaben von GartenAI nach
// festen Regeln, ohne echte KI und ohne Internet. Er spricht den normalen
// Agentenvertrag (KI-ANBINDUNG.md) – so lassen sich Angebotstext, Belege,
// Fotos und das Zeichnen im Lageplan zeigen, bevor ein echter Anbieter
// eingerichtet ist. Jede Antwort sagt, dass sie vom Demo-Agenten kommt.

export interface AgentRequest {
  task?: string;
  prompt?: string;
  context?: Record<string, unknown>;
  attachments?: { mediaType?: string; data?: string }[];
}

export interface AgentAnswer {
  text: string;
  data?: Record<string, unknown>;
}

const HINT = '(Demo-Agent ohne echte KI)';

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`;

function quoteText(context: Record<string, unknown>): string {
  const customer = typeof context.kunde === 'string' ? context.kunde : '';
  const project = typeof context.projekt === 'string' ? context.projekt : 'Ihr Vorhaben';
  const lines = Array.isArray(context.positionen) ? context.positionen : [];
  const services = lines
    .map((l) => (l && typeof l === 'object' ? String((l as { leistung?: unknown }).leistung ?? '') : ''))
    .filter(Boolean)
    .slice(0, 5);
  const greeting = /^familie\s/i.test(customer)
    ? `Sehr geehrte ${customer},`
    : 'Sehr geehrte Damen und Herren,';
  return [
    greeting,
    '',
    `vielen Dank für Ihre Anfrage zu „${project}“. Gerne bieten wir Ihnen die folgenden Arbeiten an` +
      (services.length ? `: ${list(services)}.` : '.'),
    'Alle Leistungen führen wir mit unserem eigenen Team aus. Bei Fragen oder Änderungswünschen sind wir gerne für Sie da.',
  ].join('\n');
}

function siteSummary(context: Record<string, unknown>): string {
  const messages = (Array.isArray(context.nachrichten) ? context.nachrichten : []) as {
    von?: string;
    text?: string;
  }[];
  const texts = messages.filter((m) => m.text && m.text !== '[Foto]');
  const photos = messages.length - texts.length;
  const open = texts.filter((m) =>
    /(brauche|fehlt|fehlen|bitte|noch|problem|kaputt|morgen)/i.test(m.text ?? ''),
  );
  return [
    `- ${messages.length} Nachrichten, davon ${photos} Fotos ${HINT}`,
    ...texts.slice(-3).map((m) => `- ${m.von ?? 'Jemand'}: ${m.text}`),
    open.length ? `- Offen: ${open.map((m) => m.text).join(' / ')}` : '- Keine offenen Punkte erkannt.',
  ].join('\n');
}

function photoText(attachments: AgentRequest['attachments']): string {
  const image = attachments?.[0];
  if (!image?.data) return `Kein Foto erhalten ${HINT}.`;
  const kb = Math.max(1, Math.round((image.data.length * 3) / 4 / 1024));
  const kind = (image.mediaType ?? 'Bild').replace('image/', '').toUpperCase();
  return `Foto erhalten (${kind}, ${kb} KB). Eine echte KI würde hier beschreiben, was zu sehen ist – Stand der Arbeiten, Material, Auffälligkeiten ${HINT}.`;
}

// ── Lageplan: einfache Aufträge wie „Terrasse 5 × 4 m, daneben Rasen mit Mähkante“ ──

const NUMBERS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
};
const num = (value: string) => Number(value.replace(',', '.'));

interface Placed {
  type: string;
  points: [number, number][];
  label?: string;
  props?: Record<string, unknown>;
}

export function drawPlan(instruction: string, width = 40): Placed[] {
  const objects: Placed[] = [];
  let x = 1;
  let y = 1;
  let rowHeight = 0;
  const place = (w: number, h: number) => {
    if (x + w > width - 1 && x > 1) {
      x = 1;
      y += rowHeight + 1;
      rowHeight = 0;
    }
    const at: [number, number] = [x, y];
    x += w + 1;
    rowHeight = Math.max(rowHeight, h);
    return at;
  };
  for (const part of instruction.split(/[,;.]|\bund\b|\bdaneben\b|\bdazu\b/i)) {
    const text = part.trim();
    if (!text) continue;
    const size = text.match(/(\d+(?:[.,]\d+)?)\s*(?:x|×|mal)\s*(\d+(?:[.,]\d+)?)\s*m/i);
    const length = text.match(/(\d+(?:[.,]\d+)?)\s*m\b/i);
    const count = text.match(
      /(\d+|ein|eine|einen|zwei|drei|vier|fünf|sechs)\s+(bäume|baum|sträucher|strauch|leuchten|leuchte)/i,
    );
    const area = (type: string, label: string, props?: Record<string, unknown>) => {
      const [w, h] = size ? [num(size[1]), num(size[2])] : [5, 4];
      const [ox, oy] = place(w, h);
      objects.push({
        type,
        label,
        points: [
          [ox, oy],
          [ox + w, oy],
          [ox + w, oy + h],
          [ox, oy + h],
        ],
        ...(props ? { props } : {}),
      });
    };
    if (/terrasse|pflaster|weg|einfahrt/i.test(text))
      area('paving', /terrasse/i.test(text) ? 'Terrasse' : 'Pflaster');
    else if (/rasen/i.test(text))
      area('lawn', 'Rasen', /mähkante/i.test(text) ? { mowingEdge: true } : undefined);
    else if (/beet|pflanz/i.test(text)) area('planting', 'Beet');
    else if (/parkplatz|stellpl/i.test(text)) area('parking', 'Parkplatz', { spaces: 2 });
    else if (/zaun|hecke/i.test(text)) {
      const l = length ? num(length[1]) : 10;
      const [ox, oy] = place(l, 0);
      objects.push({
        type: 'fence',
        points: [
          [ox, oy],
          [ox + l, oy],
        ],
      });
    } else if (count || /baum|bäume|strauch|leuchte/i.test(text)) {
      const n = count ? (NUMBERS[count[1].toLowerCase()] ?? Math.min(20, Number(count[1]))) : 1;
      const icon = /strauch|sträucher/i.test(text) ? 'shrub' : /leuchte/i.test(text) ? 'lamp' : 'tree';
      const [ox, oy] = place(n * 3, 2);
      for (let i = 0; i < n; i++)
        objects.push({ type: 'pictogram', points: [[ox + i * 3 + 1, oy + 1]], props: { icon } });
    }
  }
  return objects;
}

export function answer(request: AgentRequest): AgentAnswer {
  const context = request.context ?? {};
  switch (request.task) {
    case 'verbindungstest':
      return { text: 'OK' };
    case 'angebotstext':
      return { text: quoteText(context) };
    case 'baustelle_zusammenfassung':
      return { text: siteSummary(context) };
    case 'foto_beschreiben':
      return { text: photoText(request.attachments) };
    case 'beleg_lesen':
      // kann den Beleg nicht wirklich lesen: deutlich erkennbare Beispielwerte
      return {
        text: `Beispielwerte ${HINT} – bitte mit dem Beleg vergleichen.`,
        data: {
          supplierName: 'Beispiel-Lieferant (Demo-Agent)',
          invoiceNumber: 'DEMO-1',
          amount: 119,
          netAmount: 100,
          vatAmount: 19,
        },
      };
    case 'lageplan_zeichnen': {
      const instruction = (request.prompt ?? '').split('Auftrag:').pop() ?? '';
      const area = context.flaecheInMetern as { breite?: number } | undefined;
      const objects = drawPlan(instruction, area?.breite ?? 40);
      return {
        text: objects.length
          ? `${objects.length} Objekte gezeichnet ${HINT}.`
          : `Nichts erkannt ${HINT}. Beispiel: „Terrasse 5 × 4 m, daneben Rasen mit Mähkante, drei Bäume“.`,
        data: { objects },
      };
    }
    default:
      return {
        text: `Sie fragten: „${(request.prompt ?? '').slice(0, 200)}“. Der Demo-Agent antwortet ohne echte KI – für echte Antworten einen KI-Anbieter einrichten (Einstellungen → KI-Anbieter).`,
      };
  }
}
