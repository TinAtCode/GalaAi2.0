import { draftFromAi, jsonFromText } from '../src/finance/payables/ai-read';
import { imageMediaType, isPdfBuffer } from '../src/ai-gateway/images';

// Antwort der KI beim Beleg lesen: alles geprüft, nichts geraten
describe('Beleg lesen mit KI', () => {
  it('findet das JSON auch in Markdown drumherum', () => {
    expect(jsonFromText('Hier:\n```json\n{"amount": 119}\n```')).toEqual({ amount: 119 });
    expect(jsonFromText('keine Ahnung')).toBeNull();
    expect(jsonFromText('{kaputt')).toBeNull();
    expect(jsonFromText('[1,2]')).toBeNull();
  });

  it('übernimmt nur gültige Werte', () => {
    const draft = draftFromAi(
      {
        supplierName: ' Baustoff Nord GmbH ',
        invoiceNumber: 'RE-4711',
        invoiceDate: '2026-09-20',
        dueDate: '2026-02-30', // gibt es nicht
        amount: 1190.5,
        netAmount: '1000,42',
        vatAmount: -3,
        supplierIban: 'de89 3704 0044 0532 0130 00',
        discountPercent: 250,
        discountUntil: 'bald',
      },
      [],
    );
    expect(draft).toEqual({
      supplierName: 'Baustoff Nord GmbH',
      invoiceNumber: 'RE-4711',
      invoiceDate: '2026-09-20',
      dueDate: null,
      amount: '1190.50',
      netAmount: '1000.42',
      vatAmount: null,
      supplierIban: 'DE89370400440532013000',
      discountPercent: null,
      discountUntil: null,
    });
  });

  it('eigene IBAN und falsche Prüfsumme werden verworfen', () => {
    expect(
      draftFromAi({ supplierIban: 'DE89370400440532013000' }, ['DE89 3704 0044 0532 0130 00']).supplierIban,
    ).toBeNull();
    expect(draftFromAi({ supplierIban: 'DE00370400440532013000' }).supplierIban).toBeNull();
    expect(draftFromAi(null).amount).toBeNull();
  });

  it('erkennt Bildformate an den ersten Bytes', () => {
    expect(imageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageMediaType(Buffer.from('89504e470d0a1a0a0000', 'hex'))).toBe('image/png');
    expect(imageMediaType(Buffer.from('RIFF0000WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(imageMediaType(Buffer.from('GIF89a', 'latin1'))).toBe('image/gif');
    expect(imageMediaType(Buffer.from('<svg>'))).toBeNull();
    expect(isPdfBuffer(Buffer.from('%PDF-1.4'))).toBe(true);
  });
});
