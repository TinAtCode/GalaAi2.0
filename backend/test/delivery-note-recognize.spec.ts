import { recognizeDeliveryNote } from '../src/delivery-notes/recognize';

const suppliers = [
  { id: 's1', name: 'Baustoffe Meyer GmbH & Co. KG', email: 'info@meyer-baustoffe.de', matchTerms: [] },
  { id: 's2', name: 'Pflanzen Schulz', email: null, matchTerms: ['Baumschule Schulz', 'DE123456789'] },
];
const projects = [
  {
    id: 'p1',
    number: 'P-2026-0012',
    title: 'Terrassenbau Familie Müller',
    customerName: 'Familie Müller',
    street: 'Gartenweg 1',
    postalCode: '12345',
    city: 'Musterstadt',
  },
  {
    id: 'p2',
    number: 'P-2026-0013',
    title: 'Hecke pflanzen',
    customerName: 'Hausverwaltung Nord',
    street: 'Lindenstraße 22',
    postalCode: '54321',
    city: 'Nordhausen',
  },
];

describe('Lieferschein erkennen', () => {
  it('Projektnummer schlägt alles, Lieferant am Namen, Nummer und Datum', () => {
    const text = `BAUSTOFFE MEYER GmbH & Co. KG\nLieferschein Nr. LS-2026-4711\nLieferdatum: 24.09.2026\nIhr Zeichen: P-2026-0012\n20 Sack Splitt`;
    expect(recognizeDeliveryNote(text, suppliers, projects)).toEqual({
      supplierId: 's1',
      projectId: 'p1',
      noteNumber: 'LS-2026-4711',
      noteDate: '2026-09-24',
      hints: { supplier: 'Name „Baustoffe Meyer GmbH & Co. KG“', project: 'Projektnummer P-2026-0012' },
    });
  });

  it('Lieferadresse und Kommission, Lieferant an Erkennungswörtern', () => {
    const text = `Baumschule Schulz · USt-IdNr. DE123456789\nLieferschein 88123 vom 03.10.26\nLieferanschrift: Lindenstr. 22, 54321 Nordhausen\nKommission: Hausverwaltung Nord`;
    const result = recognizeDeliveryNote(text, suppliers, projects);
    expect(result).toMatchObject({ supplierId: 's2', projectId: 'p2', noteNumber: '88123' });
    expect(result.hints.project).toContain('Lieferadresse');
  });

  it('ohne eindeutigen Treffer kein Vorschlag', () => {
    const result = recognizeDeliveryNote('Lieferschein\n5 Paletten Pflaster', suppliers, projects);
    expect(result).toEqual({
      supplierId: null,
      projectId: null,
      noteNumber: null,
      noteDate: null,
      hints: {},
    });
  });
});
