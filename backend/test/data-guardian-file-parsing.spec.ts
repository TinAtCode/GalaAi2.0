import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { DataGuardianService } from '../src/data-guardian/data-guardian.service';

function makeFile(originalname: string, content: string | Buffer, mimetype = 'text/csv') {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return { originalname, buffer, mimetype } as Express.Multer.File;
}

function makeXlsxBuffer(rows: Record<string, unknown>[]): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Preisliste');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('DataGuardianService.parsePriceListFile', () => {
  const service = new DataGuardianService({} as any);

  it('liest eine CSV mit englischen Spaltennamen', () => {
    const csv = 'articleNumber,name,unit,purchasePrice,salePrice\nA-1,Schotter,Sack,5.50,8.00\n';
    const rows = service.parsePriceListFile(makeFile('preisliste.csv', csv));
    expect(rows).toEqual([
      { articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 5.5, salePrice: 8 },
    ]);
  });

  it('liest eine CSV mit deutschen Spaltennamen und deutschem Zahlenformat', () => {
    const csv =
      'Artikelnummer;Bezeichnung;Einheit;Einkaufspreis;Verkaufspreis\nA-1;Schotter;Sack;5,50;8,00\n';
    const rows = service.parsePriceListFile(makeFile('preisliste.csv', csv));
    expect(rows[0].purchasePrice).toBe(5.5);
    expect(rows[0].salePrice).toBe(8);
  });

  it('erkennt deutsches Tausender-Format (1.234,56)', () => {
    const csv = 'articleNumber,name,unit,purchasePrice,salePrice\nA-1,Bagger,Stk,"1.234,56",2000\n';
    const rows = service.parsePriceListFile(makeFile('preisliste.csv', csv));
    expect(rows[0].purchasePrice).toBe(1234.56);
    expect(rows[0].salePrice).toBe(2000);
  });

  it('wirft eine klare Fehlermeldung bei fehlenden Pflichtspalten', () => {
    const csv = 'articleNumber,name\nA-1,Schotter\n';
    expect(() => service.parsePriceListFile(makeFile('preisliste.csv', csv))).toThrow(BadRequestException);
  });

  it('wirft eine klare Fehlermeldung bei nicht lesbaren Zahlen', () => {
    const csv = 'articleNumber,name,unit,purchasePrice,salePrice\nA-1,Schotter,Sack,abc,8.00\n';
    expect(() => service.parsePriceListFile(makeFile('preisliste.csv', csv))).toThrow(BadRequestException);
  });

  it('liest eine XLSX-Datei mit derselben Spaltenerkennung', () => {
    const buffer = makeXlsxBuffer([
      { Artikelnummer: 'A-9', Bezeichnung: 'Splitt', Einheit: 'kg', EK: 1.1, VK: 2.2 },
    ]);
    const rows = service.parsePriceListFile(
      makeFile(
        'preisliste.xlsx',
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    );
    expect(rows).toEqual([
      { articleNumber: 'A-9', name: 'Splitt', unit: 'kg', purchasePrice: 1.1, salePrice: 2.2 },
    ]);
  });

  it('wirft eine Fehlermeldung bei leerer Datei', () => {
    const csv = 'articleNumber,name,unit,purchasePrice,salePrice\n';
    expect(() => service.parsePriceListFile(makeFile('preisliste.csv', csv))).toThrow(BadRequestException);
  });
});
