import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DataGuardianService } from '../src/data-guardian/data-guardian.service';

function makeFile(originalname: string, content: string | Buffer, mimetype = 'text/csv') {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return { originalname, buffer, mimetype } as Express.Multer.File;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));

describe('DataGuardianService.parsePriceListFile', () => {
  const service = new DataGuardianService({} as any);

  it('liest eine CSV mit englischen Spaltennamen', async () => {
    const csv = 'articleNumber,name,unit,purchasePrice,salePrice\nA-1,Schotter,Sack,5.50,8.00\n';
    const rows = await service.parsePriceListFile(makeFile('preisliste.csv', csv));
    expect(rows).toEqual([
      { articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 5.5, salePrice: 8 },
    ]);
  });

  it('liest eine CSV mit deutschen Spaltennamen und deutschem Zahlenformat', async () => {
    const csv =
      'Artikelnummer;Bezeichnung;Einheit;Einkaufspreis;Verkaufspreis\nA-1;Schotter;Sack;5,50;8,00\n';
    const rows = await service.parsePriceListFile(makeFile('preisliste.csv', csv));
    expect(rows[0].purchasePrice).toBe(5.5);
    expect(rows[0].salePrice).toBe(8);
  });

  it('erkennt deutsches Tausender-Format (1.234,56)', async () => {
    const csv = 'articleNumber,name,unit,purchasePrice,salePrice\nA-1,Bagger,Stk,"1.234,56",2000\n';
    const rows = await service.parsePriceListFile(makeFile('preisliste.csv', csv));
    expect(rows[0].purchasePrice).toBe(1234.56);
    expect(rows[0].salePrice).toBe(2000);
  });

  it('wirft eine klare Fehlermeldung bei fehlenden Pflichtspalten', async () => {
    const csv = 'articleNumber,name\nA-1,Schotter\n';
    await expect(service.parsePriceListFile(makeFile('preisliste.csv', csv))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('wirft eine klare Fehlermeldung bei nicht lesbaren Zahlen', async () => {
    const csv = 'articleNumber,name,unit,purchasePrice,salePrice\nA-1,Schotter,Sack,abc,8.00\n';
    await expect(service.parsePriceListFile(makeFile('preisliste.csv', csv))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('liest eine XLSX-Datei mit derselben Spaltenerkennung', async () => {
    // Fixture: Artikelnummer als Zahl und EK als Text im deutschen Format –
    // beides kommt in echten Lieferanten-Listen vor.
    const rows = await service.parsePriceListFile(
      makeFile('preisliste.xlsx', fixture('preisliste.xlsx'), XLSX_MIME),
    );
    expect(rows).toEqual([
      { articleNumber: 'A-9', name: 'Splitt', unit: 'kg', purchasePrice: 1.1, salePrice: 2.2 },
      { articleNumber: '4711', name: 'Rindenmulch', unit: 'm3', purchasePrice: 12.5, salePrice: 19 },
    ]);
  });

  it('lehnt das alte .xls-Format mit einer klaren Meldung ab', async () => {
    await expect(
      service.parsePriceListFile(
        makeFile('preisliste.xls', fixture('preisliste.xls'), 'application/vnd.ms-excel'),
      ),
    ).rejects.toThrow(/\.xlsx oder \.csv/);
  });

  it('meldet eine kaputte Excel-Datei als 400 statt als Serverfehler', async () => {
    await expect(
      service.parsePriceListFile(makeFile('preisliste.xlsx', Buffer.from('kein excel'), XLSX_MIME)),
    ).rejects.toThrow(BadRequestException);
  });

  it('wirft eine Fehlermeldung bei leerer Datei', async () => {
    const csv = 'articleNumber,name,unit,purchasePrice,salePrice\n';
    await expect(service.parsePriceListFile(makeFile('preisliste.csv', csv))).rejects.toThrow(
      BadRequestException,
    );
  });
});
