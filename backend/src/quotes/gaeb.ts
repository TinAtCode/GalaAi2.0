import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';

// GAEB DA XML (3.x): Leistungsverzeichnisse des Auftraggebers einlesen
// (X81/X82/X83/X86 – alles mit Positionen und Mengen) und das Angebot als
// X84 (Angebotsabgabe) zurückgeben. Nur was ein Angebot braucht: Gliederung,
// Ordnungszahl (OZ), Kurztext, Menge, Einheit – und bei der Abgabe
// Einheits- und Gesamtpreis.

// Gliederung des LV (BoQBkdn), z.B. Los/Titel 2-stellig, Position 4-stellig
export interface GaebLevel {
  type: string; // BoQLevel, Item, Index …
  length: number;
}

export interface GaebInfo {
  projectName: string | null;
  projectLabel: string | null;
  boqName: string | null;
  boqLabel: string | null;
  levels: GaebLevel[];
  // Bezeichnungen der Titel je OZ-Präfix, z.B. { "01": "Erdarbeiten" }
  categories: Record<string, string>;
  phase: string | null; // DP der eingelesenen Datei (81, 83 …)
}

export interface GaebItem {
  oz: string;
  shortText: string;
  quantity: number;
  unit: string;
}

export interface GaebParseResult {
  info: GaebInfo;
  items: GaebItem[];
  // nicht übernommen: Bedarfs-/Wahlpositionen, Positionen ohne Menge
  skipped: { oz: string; reason: string }[];
}

type Node = Record<string, unknown>;
const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

// Text aus den verschachtelten GAEB-Textelementen (<p><span>…</span></p>)
function textOf(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const node = value as Node;
    return Object.entries(node)
      .filter(([key]) => !key.startsWith('@_'))
      .map(([key, v]) => (key === '#text' ? String(v) : textOf(v)))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

// Kurztext: OutlineText, sonst der Anfang des Langtexts
function shortTextOf(item: Node): string {
  const complete = ((item.Description as Node | undefined)?.CompleteText ?? {}) as Node;
  const outline = clean(textOf((complete.OutlineText as Node | undefined)?.OutlTxt ?? complete.OutlineText));
  if (outline) return outline;
  return clean(textOf(complete.DetailTxt));
}

const number = (value: unknown) => {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export function parseGaeb(content: Buffer | string): GaebParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    processEntities: true,
  });
  const text = typeof content === 'string' ? content : content.toString('utf8');
  // GAEB braucht keine DTD; ohne sie gibt es auch keine Entity-Tricks (XXE, „Billion Laughs“)
  if (/<!DOCTYPE/i.test(text))
    throw new BadRequestException('GAEB-Dateien mit DOCTYPE werden nicht angenommen.');
  let doc: Node;
  try {
    doc = parser.parse(text) as Node;
  } catch {
    throw new BadRequestException('Die Datei ist kein lesbares GAEB DA XML.');
  }
  const gaeb = doc.GAEB as Node | undefined;
  const award = gaeb?.Award as Node | undefined;
  const boq = award?.BoQ as Node | undefined;
  if (!gaeb || !award || !boq) {
    throw new BadRequestException(
      'Kein GAEB-Leistungsverzeichnis gefunden (GAEB DA XML mit Award/BoQ, z.B. .X83). GAEB 90 und 2000 werden nicht unterstützt.',
    );
  }
  const prj = (gaeb.PrjInfo ?? {}) as Node;
  const boqInfo = (boq.BoQInfo ?? {}) as Node;
  const levels = asArray(boqInfo.BoQBkdn as Node | Node[]).map((b) => ({
    type: String(b.Type ?? ''),
    length: Number(b.Length ?? 0),
  }));

  const info: GaebInfo = {
    projectName: clean(textOf(prj.NamePrj)) || null,
    projectLabel: clean(textOf(prj.LblPrj)) || null,
    boqName: clean(textOf(boqInfo.Name)) || null,
    boqLabel: clean(textOf(boqInfo.LblTx)) || null,
    levels,
    categories: {},
    phase: award.DP !== undefined ? String(award.DP) : null,
  };
  const items: GaebItem[] = [];
  const skipped: GaebParseResult['skipped'] = [];

  const walk = (body: Node | undefined, prefix: string[]) => {
    if (!body) return;
    for (const ctgy of asArray(body.BoQCtgy as Node | Node[])) {
      const part = String(ctgy['@_RNoPart'] ?? '');
      const path = [...prefix, part];
      const label = clean(textOf(ctgy.LblTx));
      if (label) info.categories[path.join('.')] = label;
      walk(ctgy.BoQBody as Node | undefined, path);
    }
    for (const list of asArray(body.Itemlist as Node | Node[])) {
      for (const item of asArray(list.Item as Node | Node[])) {
        const oz = [...prefix, String(item['@_RNoPart'] ?? '')].join('.');
        const shortText = shortTextOf(item) || `Position ${oz}`;
        // Bedarfsposition ohne Gesamtbetrag (Eventualposition) zählt nicht zur
        // Summe; „WithTotal“ ist eine normale Position mit Preis
        if (item.Provis !== undefined && String(textOf(item.Provis)).trim() !== 'WithTotal') {
          skipped.push({ oz, reason: 'Bedarfsposition (ohne Gesamtbetrag)' });
          continue;
        }
        if (item.ALNSerNo !== undefined) {
          skipped.push({ oz, reason: 'Wahlposition' });
          continue;
        }
        const quantity = number(item.Qty);
        if (!(quantity > 0)) {
          skipped.push({ oz, reason: 'ohne Menge' });
          continue;
        }
        items.push({
          oz,
          shortText: shortText.slice(0, 500),
          quantity: Math.round(quantity * 1000) / 1000,
          unit: clean(textOf(item.QU)).slice(0, 20) || 'psch',
        });
      }
    }
  };
  walk(boq.BoQBody as Node | undefined, []);
  if (items.length === 0 && skipped.length === 0) {
    throw new BadRequestException('Das Leistungsverzeichnis enthält keine Positionen.');
  }
  return { info, items, skipped };
}

// ── Angebotsabgabe X84 ──────────────────────────────────────────────

export interface GaebExportLine {
  gaebOz: string | null;
  description: string;
  unit: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

export interface GaebExportInput {
  info: GaebInfo | null;
  quoteNumber: string;
  projectTitle: string;
  bidder: { name: string; street?: string | null; postalCode?: string | null; city?: string | null };
  lines: GaebExportLine[];
  createdAt: Date;
}

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (value: Prisma.Decimal) => value.toFixed(2);
const qty = (value: Prisma.Decimal) => value.toFixed(3);

interface Tree {
  children: Map<string, Tree>;
  items: { part: string; line: GaebExportLine }[];
}

// Positionen ohne OZ (im Angebot ergänzt) bekommen eine eigene OZ hinter
// dem LV: bei Titeln einen neuen Titel „Zusätzliche Positionen“
function assignOz(lines: GaebExportLine[], levels: GaebLevel[]) {
  const itemLength = levels.find((l) => l.type === 'Item')?.length || 4;
  const ctgyLevels = levels.filter((l) => l.type === 'BoQLevel');
  const pad = (n: number, len: number) => String(n).padStart(len, '0');
  const withOz = lines.filter((l) => l.gaebOz);
  const without = lines.filter((l) => !l.gaebOz);
  const extraLabel = new Map<string, string>();
  if (without.length === 0) return { lines, extraLabel };
  let prefix: string[] = [];
  if (ctgyLevels.length) {
    const tops = withOz.map((l) => Number(l.gaebOz!.split('.')[0])).filter(Number.isFinite);
    const top = pad((tops.length ? Math.max(...tops) : 0) + 1, ctgyLevels[0].length);
    prefix = [top, ...ctgyLevels.slice(1).map((l) => pad(1, l.length))];
    for (let i = 1; i <= prefix.length; i++)
      extraLabel.set(prefix.slice(0, i).join('.'), 'Zusätzliche Positionen');
  }
  const usedOz = new Set(withOz.map((l) => l.gaebOz!));
  const numeric = withOz
    .filter((l) => l.gaebOz!.split('.').slice(0, -1).join('.') === prefix.join('.'))
    .map((l) => Number(l.gaebOz!.split('.').pop()))
    .filter(Number.isFinite);
  const max = 10 ** itemLength - 1;
  // in Zehnerschritten hinter der letzten OZ; reicht der Platz nicht, Einerschritte
  let step = 10;
  let next = (numeric.length ? Math.max(...numeric) : 0) + step;
  if (next + (without.length - 1) * step > max) {
    step = 1;
    next = (numeric.length ? Math.max(...numeric) : 0) + 1;
  }
  const assigned = without.map((l) => {
    while (next <= max && usedOz.has([...prefix, pad(next, itemLength)].join('.'))) next += step;
    if (next > max)
      throw new BadRequestException(
        'Für die zusätzlichen Positionen ist in der Gliederung des Leistungsverzeichnisses keine Ordnungszahl mehr frei.',
      );
    const oz = [...prefix, pad(next, itemLength)].join('.');
    usedOz.add(oz);
    next += step;
    return { ...l, gaebOz: oz };
  });
  return { lines: [...withOz, ...assigned], extraLabel };
}

export function buildX84(input: GaebExportInput): Buffer {
  const levels: GaebLevel[] = input.info?.levels.length ? input.info.levels : [{ type: 'Item', length: 4 }];
  // ohne eingelesenes LV: fortlaufende OZ 0010, 0020 …
  const source = input.info ? input.lines : input.lines.map((l) => ({ ...l, gaebOz: null }));
  const { lines, extraLabel } = assignOz(source, levels);
  const labels = { ...(input.info?.categories ?? {}), ...Object.fromEntries(extraLabel) };

  const root: Tree = { children: new Map(), items: [] };
  for (const line of lines) {
    const parts = line.gaebOz!.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map(), items: [] });
      node = node.children.get(part)!;
    }
    node.items.push({ part: parts[parts.length - 1], line });
  }
  const total = (node: Tree): Prisma.Decimal =>
    [...node.children.values()].reduce(
      (sum, child) => sum.plus(total(child)),
      node.items.reduce((sum, i) => sum.plus(i.line.lineTotal), new Prisma.Decimal(0)),
    );

  // ID-Attribute wie in GAEB DA XML üblich (eindeutig, beginnen mit Buchstaben)
  let idSeq = 0;
  const nextId = (prefix: string) => `${prefix}${++idSeq}`;
  const boqId = nextId('B');
  const indent = (depth: number) => '  '.repeat(depth);
  const body = (node: Tree, path: string[], depth: number): string[] => {
    const out = [`${indent(depth)}<BoQBody>`];
    for (const [part, child] of [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const key = [...path, part].join('.');
      out.push(`${indent(depth + 1)}<BoQCtgy ID="${nextId('C')}" RNoPart="${esc(part)}">`);
      if (labels[key]) out.push(`${indent(depth + 2)}<LblTx><p><span>${esc(labels[key])}</span></p></LblTx>`);
      out.push(...body(child, [...path, part], depth + 2));
      out.push(`${indent(depth + 2)}<Totals><Total>${money(total(child))}</Total></Totals>`);
      out.push(`${indent(depth + 1)}</BoQCtgy>`);
    }
    if (node.items.length) {
      out.push(`${indent(depth + 1)}<Itemlist>`);
      for (const { part, line } of [...node.items].sort((a, b) => a.part.localeCompare(b.part))) {
        out.push(
          `${indent(depth + 2)}<Item ID="${nextId('I')}" RNoPart="${esc(part)}">`,
          `${indent(depth + 3)}<Qty>${qty(line.quantity)}</Qty>`,
          // Einheit wie in GAEB üblich: m2/m3 statt m²/m³
          `${indent(depth + 3)}<QU>${esc(line.unit.replace(/²/g, '2').replace(/³/g, '3'))}</QU>`,
          `${indent(depth + 3)}<UP>${money(line.unitPrice)}</UP>`,
          `${indent(depth + 3)}<IT>${money(line.lineTotal)}</IT>`,
          // Kurztext zur Kontrolle beim Einlesen (Pflicht ist er in X84 nicht)
          `${indent(depth + 3)}<Description><CompleteText><OutlineText><OutlTxt><TextOutlTxt><p><span>${esc(line.description)}</span></p></TextOutlTxt></OutlTxt></OutlineText></CompleteText></Description>`,
          `${indent(depth + 2)}</Item>`,
        );
      }
      out.push(`${indent(depth + 1)}</Itemlist>`);
    }
    out.push(`${indent(depth)}</BoQBody>`);
    return out;
  };

  const date = input.createdAt.toISOString().slice(0, 10);
  const time = input.createdAt.toISOString().slice(11, 19);
  const b = input.bidder;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA84/3.2">',
    '  <GAEBInfo>',
    '    <Version>3.2</Version>',
    '    <VersDate>2013-10</VersDate>',
    `    <Date>${date}</Date>`,
    `    <Time>${time}</Time>`,
    '    <ProgSystem>gAla</ProgSystem>',
    '  </GAEBInfo>',
    '  <PrjInfo>',
    `    <NamePrj>${esc(input.info?.projectName ?? input.quoteNumber)}</NamePrj>`,
    `    <LblPrj>${esc(input.info?.projectLabel ?? input.projectTitle)}</LblPrj>`,
    '    <Cur>EUR</Cur>',
    '    <CurLbl>Euro</CurLbl>',
    '  </PrjInfo>',
    '  <Award>',
    '    <DP>84</DP>',
    '    <CTR>',
    '      <Address>',
    `        <Name1>${esc(b.name)}</Name1>`,
    ...(b.street ? [`        <Street>${esc(b.street)}</Street>`] : []),
    ...(b.postalCode ? [`        <PCode>${esc(b.postalCode)}</PCode>`] : []),
    ...(b.city ? [`        <City>${esc(b.city)}</City>`] : []),
    '      </Address>',
    '    </CTR>',
    `    <BoQ ID="${boqId}">`,
    '      <BoQInfo>',
    `        <Name>${esc(input.info?.boqName ?? input.quoteNumber)}</Name>`,
    `        <LblTx><p><span>${esc(input.info?.boqLabel ?? `Angebot ${input.quoteNumber}`)}</span></p></LblTx>`,
    ...levels.map(
      (l) =>
        `        <BoQBkdn><Type>${esc(l.type)}</Type><Length>${l.length}</Length><Num>Yes</Num></BoQBkdn>`,
    ),
    '      </BoQInfo>',
    ...body(root, [], 3),
    `      <Totals><Total>${money(total(root))}</Total></Totals>`,
    '    </BoQ>',
    '  </Award>',
    '</GAEB>',
    '',
  ].join('\n');
  return Buffer.from(xml, 'utf8');
}
