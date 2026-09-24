import * as iconv from 'iconv-lite';
import { detectEntity, matchRows, parseMoney, parseRows, similarity, suggestMapping } from './entities';
import { parseSource, parseText } from './parse-source';

describe('Stammdaten-Import: Quellen lesen', () => {
  it('CSV mit Semikolon in Windows-1252 (Excel unter Windows)', async () => {
    const csv =
      'Kundenname;Straße;PLZ;Ort\r\nMüller GbR;Gartenweg 1;1067;Dresden\r\n;;;\r\nBäckerei Groß;Hauptstr. 5;50667;Köln\r\n';
    const table = await parseSource('kunden.csv', iconv.encode(csv, 'win1252'));
    expect(table.headers).toEqual(['Kundenname', 'Straße', 'PLZ', 'Ort']);
    expect(table.rows).toEqual([
      ['Müller GbR', 'Gartenweg 1', '1067', 'Dresden'],
      ['Bäckerei Groß', 'Hauptstr. 5', '50667', 'Köln'],
    ]);
  });

  it('aus Excel kopierter Text (Tabs), UTF-8 mit BOM, doppelte Spaltennamen', async () => {
    const table = await parseSource(
      'x.txt',
      Buffer.from('﻿Name\tTelefon\tTelefon\nGrün AG\t0221 1\t0171 2\n'),
    );
    expect(table.headers).toEqual(['Name', 'Telefon', 'Telefon (2)']);
    expect(table.rows[0]).toEqual(['Grün AG', '0221 1', '0171 2']);
  });

  it('JSON-Liste, auch unter einem Schlüssel', () => {
    expect(parseText('[{"name":"A","ek":"1,50"},{"name":"B","vk":2}]')).toEqual({
      headers: ['name', 'ek', 'vk'],
      rows: [
        ['A', '1,50', ''],
        ['B', '', '2'],
      ],
    });
    expect(parseText('{"items":[{"name":"C"}]}').rows).toEqual([['C']]);
    expect(() => parseText('{"name":"x"}')).toThrow('Liste von Objekten');
  });

  it('vCard mit Firma, Adresse und gefalteten Zeilen', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Anna Schmidt',
      'ORG:Hausverwaltung Rhein GmbH;Technik',
      'EMAIL;TYPE=work:anna@rhein.example',
      'TEL;TYPE=cell:+49 171 123',
      'ADR;TYPE=work:;;Ringstraße 5;Köln;;50667;Deutschland',
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:Peter',
      '  Meier',
      'END:VCARD',
    ].join('\r\n');
    const table = parseText(vcf);
    expect(table.rows).toEqual([
      [
        'Hausverwaltung Rhein GmbH',
        'Anna Schmidt',
        'anna@rhein.example',
        '+49 171 123',
        'Ringstraße 5',
        '50667',
        'Köln',
      ],
      ['Peter Meier', '', '', '', '', '', ''],
    ]);
  });

  it('lehnt .xls und leere Quellen ab', async () => {
    await expect(parseSource('alt.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1]))).rejects.toThrow('.xls');
    expect(() => parseText('   ')).toThrow('leer');
    expect(() => parseText('Name;Ort\n')).toThrow('keine Datenzeilen');
  });
});

describe('Stammdaten-Import: Zuordnung und Abgleich', () => {
  it('ordnet Spalten zu und erkennt die Datenart', () => {
    const headers = ['Art.-Nr.', 'Artikelbezeichnung', 'ME', 'EK netto', 'VK'];
    expect(suggestMapping('articles', headers)).toEqual({
      articleNumber: 'Art.-Nr.',
      name: 'Artikelbezeichnung',
      unit: 'ME',
      purchasePrice: 'EK netto',
      salePrice: 'VK',
    });
    expect(detectEntity(headers)).toBe('articles');
    expect(detectEntity(['Firma', 'E-Mail', 'Straße', 'PLZ', 'Ort'])).toBe('customers');
    expect(detectEntity(['Maschine', 'Stundensatz'])).toBe('machines');
  });

  it('liest Beträge, Ja/Nein, PLZ und Einheiten', () => {
    expect(parseMoney('1.234,56 €')).toBe(1234.56);
    expect(parseMoney('1,234.56')).toBe(1234.56);
    expect(parseMoney('12,5')).toBe(12.5);
    expect(parseMoney('abc')).toBeNaN();
    const [row] = parseRows(
      'customers',
      ['Name', 'PLZ', 'Gewerblich', 'Konto', 'Mail'],
      [['Grün AG', '1067', 'ja', '10001', 'kein-mail']],
      { name: 'Name', postalCode: 'PLZ', isBusiness: 'Gewerblich', debtorNumber: 'Konto', email: 'Mail' },
    );
    expect(row.values).toEqual({
      name: 'Grün AG',
      postalCode: '01067',
      isBusiness: true,
      debtorNumber: 10001,
    });
    expect(row.errors).toEqual(['E-Mail: „kein-mail“ ist keine E-Mail-Adresse']);
    const [article] = parseRows('articles', ['Nr', 'Name', 'ME'], [['A1', 'Mulch', 'qm']], {
      articleNumber: 'Nr',
      name: 'Name',
      unit: 'ME',
    });
    expect(article.values.unit).toBe('m²');
  });

  it('gleicht mit dem Bestand ab: neu, geändert, gleich, Dublette, doppelt, fehlerhaft', () => {
    const existing = [
      {
        id: 'c1',
        name: 'Müller GmbH',
        email: 'info@mueller.example',
        postalCode: '50667',
        city: 'Köln',
        debtorNumber: 10001,
      },
      {
        id: 'c2',
        name: 'Gartenfreunde Süd e.V.',
        email: null,
        postalCode: '80331',
        city: 'München',
        debtorNumber: null,
      },
      { id: 'c3', name: 'Schmidt', email: null, postalCode: '10115', city: 'Berlin', debtorNumber: null },
    ];
    const headers = ['Name', 'Mail', 'PLZ', 'Ort', 'Konto'];
    const rows = parseRows(
      'customers',
      headers,
      [
        ['Müller GmbH', 'info@mueller.example', '50667', 'Köln', '10001'], // gleich
        ['Müller', 'neu@mueller.example', '50667', 'Köln', '10001'], // gleiche Debitorennummer: doppelt in der Quelle
        ['Gartenfreunde Sued e.V.', 'kontakt@gf.example', '80331', 'Muenchen', ''], // Name+PLZ (ü = ue, ohne e.V.)
        ['Gartenfreunde Süd', '', '80331', 'München', ''], // derselbe Bestandseintrag noch einmal
        ['Schmidt', '', '20095', 'Hamburg', ''], // gleicher Name, andere PLZ -> Dublette?
        ['Neukunde KG', '', '', '', ''],
        ['', 'x@y.de', '', '', ''],
      ],
      { name: 'Name', email: 'Mail', postalCode: 'PLZ', city: 'Ort', debtorNumber: 'Konto' },
    );
    const matched = matchRows('customers', rows, existing);
    expect(matched.map((r) => r.status)).toEqual([
      'unchanged',
      'invalid',
      'update',
      'invalid',
      'duplicate',
      'new',
      'invalid',
    ]);
    expect(matched[1].errors[0]).toContain('doppelt');
    expect(matched[2].matchedBy).toBe('Name und PLZ');
    expect(matched[2].changes.map((c) => c.field).sort()).toEqual(['city', 'email']);
    expect(matched[3].errors[0]).toContain('denselben Eintrag wie Zeile 4');
    expect(matched[4].similar[0].id).toBe('c3');
    expect(matched.map((r) => r.preselected)).toEqual([false, false, true, false, false, true, false]);
  });

  it('Ähnlichkeit von Namen ohne Rechtsform', () => {
    expect(similarity('Müller GmbH', 'Müller')).toBe(1);
    expect(similarity('Gartenbau Meier', 'Gartenbau Maier')).toBeGreaterThan(0.8);
    expect(similarity('Gartenbau Meier', 'Dachdecker Schulz')).toBeLessThan(0.3);
  });

  it('Artikel nach Artikelnummer, Preise mit Toleranz', () => {
    const rows = parseRows(
      'articles',
      ['Nr', 'Name', 'EK', 'VK'],
      [
        ['A1', 'Rindenmulch', '12,40', '19,90'],
        ['A2', 'Kies', '30', '45'],
      ],
      { articleNumber: 'Nr', name: 'Name', purchasePrice: 'EK', salePrice: 'VK' },
    );
    const matched = matchRows('articles', rows, [
      {
        id: 'a1',
        articleNumber: 'A1',
        name: 'Rindenmulch',
        unit: 'm³',
        purchasePrice: 12.4,
        salePrice: 18.5,
      },
    ]);
    expect(matched[0]).toMatchObject({ status: 'update', matchId: 'a1' });
    expect(matched[0].changes).toEqual([
      { field: 'salePrice', label: 'Verkaufspreis', old: 18.5, new: 19.9 },
    ]);
    expect(matched[1].status).toBe('new');
  });
});
