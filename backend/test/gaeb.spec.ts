import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { buildX84, parseGaeb } from '../src/quotes/gaeb';

const lv = readFileSync(join(__dirname, 'fixtures/gaeb/aussenanlagen.X83'));
const d = (v: number | string) => new Prisma.Decimal(v);

describe('GAEB DA XML', () => {
  it('liest Gliederung, OZ, Kurztext, Menge und Einheit', () => {
    const { info, items, skipped } = parseGaeb(lv);
    expect(info).toMatchObject({
      projectName: '2026-117',
      projectLabel: 'Kita Sonnenblume, Außenanlagen',
      boqName: 'LV 01',
      boqLabel: 'Außenanlagen & Pflaster',
      phase: '83',
      levels: [
        { type: 'BoQLevel', length: 2 },
        { type: 'Item', length: 4 },
      ],
      categories: { '01': 'Erdarbeiten', '02': 'Pflasterarbeiten' },
    });
    expect(items).toEqual([
      { oz: '01.0010', shortText: 'Oberboden abtragen', quantity: 125.5, unit: 'm2' },
      // ohne Kurztext: Anfang des Langtexts, Absätze zusammengefügt
      {
        oz: '01.0020',
        shortText: 'Boden lösen und laden, Bodenklasse 3–5, abfahren & entsorgen.',
        quantity: 42,
        unit: 'm3',
      },
      { oz: '02.0010', shortText: 'Betonpflaster verlegen', quantity: 80, unit: 'm2' },
    ]);
    expect(skipped).toEqual([
      { oz: '01.0030', reason: 'Bedarfsposition (ohne Gesamtbetrag)' },
      { oz: '02.0020', reason: 'ohne Menge' },
      { oz: '02.0030', reason: 'Wahlposition' },
    ]);
  });

  it('lehnt andere Dateien verständlich ab', () => {
    expect(() => parseGaeb('kein xml <<<')).toThrow(/GAEB/);
    expect(() => parseGaeb('<?xml version="1.0"?><Invoice/>')).toThrow(/Kein GAEB-Leistungsverzeichnis/);
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "xxxxxxxx">]><GAEB><Award><BoQ/></Award></GAEB>';
    expect(() => parseGaeb(bomb)).toThrow(/DOCTYPE/);
  });

  it('X84: Preise unter den OZ des LV, Summen je Titel; ergänzte Positionen in eigenem Titel', () => {
    const { info } = parseGaeb(lv);
    const xml = buildX84({
      info,
      quoteNumber: 'A-2026-0007',
      projectTitle: 'Kita',
      bidder: { name: 'Grün & Stein GmbH', street: 'Weg 1', postalCode: '50667', city: 'Köln' },
      createdAt: new Date('2026-09-25T10:00:00Z'),
      lines: [
        {
          gaebOz: '01.0010',
          description: 'Oberboden abtragen',
          unit: 'm2',
          quantity: d('125.5'),
          unitPrice: d('4.2'),
          lineTotal: d('527.1'),
        },
        {
          gaebOz: '02.0010',
          description: 'Betonpflaster verlegen',
          unit: 'm2',
          quantity: d(80),
          unitPrice: d('38.5'),
          lineTotal: d(3080),
        },
        {
          gaebOz: null,
          description: 'Zusatz: Rasen <neu>',
          unit: 'm2',
          quantity: d(10),
          unitPrice: d(5),
          lineTotal: d(50),
        },
      ],
    }).toString('utf8');
    expect(xml).toContain('<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA84/3.2">');
    expect(xml).toContain('<DP>84</DP>');
    expect(xml).toContain('<Name1>Grün &amp; Stein GmbH</Name1>');
    expect(xml).toContain('<BoQBkdn><Type>BoQLevel</Type><Length>2</Length><Num>Yes</Num></BoQBkdn>');
    expect(xml).toContain('Zusatz: Rasen &lt;neu&gt;');
    // gesamt 3657,10; Titel 01 527,10
    expect(xml).toContain('<Totals><Total>3657.10</Total></Totals>');
    expect(xml).toContain('<Totals><Total>527.10</Total></Totals>');

    // die eigene Datei lässt sich wieder einlesen: dieselben OZ und Mengen
    const back = parseGaeb(xml);
    expect(back.items.map((i) => [i.oz, i.quantity, i.unit])).toEqual([
      ['01.0010', 125.5, 'm2'],
      ['02.0010', 80, 'm2'],
      ['03.0010', 10, 'm2'],
    ]);
    expect(back.info.categories['03']).toBe('Zusätzliche Positionen');
    expect(back.info.phase).toBe('84');
    expect(xml).toMatch(
      /<Item ID="I\d+" RNoPart="0010">\s*<Qty>125\.500<\/Qty>\s*<QU>m2<\/QU>\s*<UP>4\.20<\/UP>\s*<IT>527\.10<\/IT>/,
    );
  });

  it('X84 ohne eingelesenes LV: fortlaufende OZ 0010, 0020 …', () => {
    const xml = buildX84({
      info: null,
      quoteNumber: 'A-2026-0001',
      projectTitle: 'Garten Müller',
      bidder: { name: 'Firma' },
      createdAt: new Date('2026-09-25T10:00:00Z'),
      lines: [
        {
          gaebOz: null,
          description: 'Hecke schneiden',
          unit: 'm',
          quantity: d(50),
          unitPrice: d(3),
          lineTotal: d(150),
        },
        {
          gaebOz: null,
          description: 'Grünschnitt entsorgen',
          unit: 'psch',
          quantity: d(1),
          unitPrice: d(80),
          lineTotal: d(80),
        },
      ],
    }).toString('utf8');
    expect(parseGaeb(xml).items.map((i) => i.oz)).toEqual(['0010', '0020']);
    expect(xml).toContain('<LblPrj>Garten Müller</LblPrj>');
  });

  it('Bedarfsposition mit Gesamtbetrag (WithTotal) ist eine normale Position', () => {
    const xml = lv.toString('utf8').replace('<Provis>WithoutTotal</Provis>', '<Provis>WithTotal</Provis>');
    const { items, skipped } = parseGaeb(xml);
    expect(items.map((i) => i.oz)).toContain('01.0030');
    expect(skipped.map((s) => s.oz)).not.toContain('01.0030');
  });

  it('X84: IDs für BoQ, Titel und Positionen; freie OZ auch bei Buchstaben-OZ und vollem Bereich', () => {
    const line = (gaebOz: string | null) => ({
      gaebOz,
      description: 'X',
      unit: 'm',
      quantity: d(1),
      unitPrice: d(1),
      lineTotal: d(1),
    });
    const flat = {
      projectName: null,
      projectLabel: null,
      boqName: null,
      boqLabel: null,
      categories: {},
      phase: '83',
    };
    const xml = buildX84({
      info: { ...flat, levels: [{ type: 'Item', length: 4 }] },
      quoteNumber: 'A-1',
      projectTitle: 'P',
      bidder: { name: 'F' },
      createdAt: new Date('2026-09-25T10:00:00Z'),
      lines: [line('001A'), line('0020'), line(null)],
    }).toString('utf8');
    expect(xml).not.toContain('NaN');
    expect(xml).toMatch(/<BoQ ID="B\d+">/);
    expect(xml).toMatch(/<Item ID="I\d+" RNoPart="0030">/);
    const ids = [...xml.matchAll(/ ID="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);

    // letzte OZ 9990: Zehnerschritte passen nicht mehr → Einerschritte
    const full = buildX84({
      info: { ...flat, levels: [{ type: 'Item', length: 4 }] },
      quoteNumber: 'A-1',
      projectTitle: 'P',
      bidder: { name: 'F' },
      createdAt: new Date('2026-09-25T10:00:00Z'),
      lines: [line('9990'), line(null)],
    }).toString('utf8');
    expect(full).toContain('RNoPart="9991"');
    expect(() =>
      buildX84({
        info: { ...flat, levels: [{ type: 'Item', length: 4 }] },
        quoteNumber: 'A-1',
        projectTitle: 'P',
        bidder: { name: 'F' },
        createdAt: new Date('2026-09-25T10:00:00Z'),
        lines: [line('9999'), line(null)],
      }),
    ).toThrow(/keine Ordnungszahl mehr frei/);
  });
});
