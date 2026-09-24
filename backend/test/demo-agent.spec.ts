import { answer, drawPlan } from '../src/demo-agent/demo-agent';
import { objectsFromAi } from '../src/plans/plan-ai';

// Demo-Agent: feste Regeln statt KI, aber im echten Agentenvertrag
describe('Demo-Agent', () => {
  it('Angebotstext aus Kunde, Projekt und Leistungen', () => {
    const { text } = answer({
      task: 'angebotstext',
      context: {
        kunde: 'Familie Müller',
        projekt: 'Terrassenbau',
        positionen: [{ leistung: 'Terrasse verlegen' }, { leistung: 'Rasen anlegen' }],
      },
    });
    expect(text).toContain('Sehr geehrte Familie Müller,');
    expect(text).toContain('„Terrassenbau“');
    expect(text).toContain('Terrasse verlegen und Rasen anlegen');
  });

  it('Zusammenfassung mit offenen Punkten', () => {
    const { text } = answer({
      task: 'baustelle_zusammenfassung',
      context: {
        nachrichten: [
          { von: 'Max', text: 'Brauchen morgen noch 2 t Grauwacke.' },
          { von: 'Birgit', text: '[Foto]' },
        ],
      },
    });
    expect(text).toContain('2 Nachrichten, davon 1 Fotos');
    expect(text).toContain('Offen: Brauchen morgen noch 2 t Grauwacke.');
  });

  it('Beleg: erkennbare Beispielwerte, Foto: Größe', () => {
    expect(answer({ task: 'beleg_lesen' }).data).toMatchObject({
      supplierName: 'Beispiel-Lieferant (Demo-Agent)',
    });
    expect(
      answer({ task: 'foto_beschreiben', attachments: [{ mediaType: 'image/png', data: 'A'.repeat(4096) }] })
        .text,
    ).toContain('PNG, 3 KB');
  });

  it('zeichnet einfache Aufträge, die GartenAI übernimmt', () => {
    const drawn = drawPlan('Terrasse 5 × 4 m, daneben Rasen 10x6 m mit Mähkante, drei Bäume und Zaun 12 m');
    expect(drawn.map((o) => o.type)).toEqual([
      'paving',
      'lawn',
      'pictogram',
      'pictogram',
      'pictogram',
      'fence',
    ]);
    expect(drawn[0].points).toEqual([
      [1, 1],
      [6, 1],
      [6, 5],
      [1, 5],
    ]);
    expect(drawn[1].props).toEqual({ mowingEdge: true });
    // alles gültig nach den Regeln des Lageplans
    expect(objectsFromAi(drawn, 50)).toMatchObject({ dropped: 0 });
    const { data } = answer({ task: 'lageplan_zeichnen', prompt: 'Regeln …\n\nAuftrag: Rasen', context: {} });
    expect((data!.objects as unknown[]).length).toBe(1);
  });

  it('bricht in die nächste Reihe um', () => {
    const drawn = drawPlan('Rasen 30 x 5 m, Terrasse 20 x 5 m', 40);
    expect(drawn[1].points[0]).toEqual([1, 7]);
  });
});
