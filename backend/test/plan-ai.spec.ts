import { objectsFromAi, planForAi } from '../src/plans/plan-ai';

// Zeichnen mit KI: Meter <-> Planeinheiten, ungültige Objekte fallen weg
describe('Lageplan zeichnen mit KI', () => {
  it('rechnet Meter in Planeinheiten um und vergibt eigene IDs', () => {
    const { objects, dropped } = objectsFromAi(
      [
        {
          type: 'lawn',
          points: [
            [1, 1],
            [6, 1],
            [6, 5],
            [1, 5],
          ],
          props: { mowingEdge: true },
          id: 'fremd',
        },
        { type: 'pictogram', points: [[3, 3]], props: { icon: 'tree' }, label: ' Apfelbaum ' },
      ],
      50,
    );
    expect(dropped).toBe(0);
    expect(objects[0]).toMatchObject({
      type: 'lawn',
      points: [
        [50, 50],
        [300, 50],
        [300, 250],
        [50, 250],
      ],
    });
    expect(objects[0].id).toMatch(/^ki-/);
    expect(objects[1]).toMatchObject({ label: 'Apfelbaum', points: [[150, 150]] });
  });

  it('verwirft, was nicht passt', () => {
    const { objects, dropped } = objectsFromAi(
      [
        {
          type: 'lawn',
          points: [
            [0, 0],
            [1, 1],
          ],
        }, // Fläche mit 2 Punkten
        { type: 'rakete', points: [[0, 0]] },
        { type: 'pictogram', points: [[0, 0]], props: { icon: 'ufo' } },
        {
          type: 'fence',
          points: [
            [0, 0],
            ['a', 1],
          ],
        },
        { type: 'text', points: [[1, 1]] }, // Text ohne Beschriftung
        {
          type: 'fence',
          points: [
            [0, 0],
            [2, 0],
          ],
          props: { unbekannt: 1 },
        },
        null,
        {
          type: 'fence',
          points: [
            [0, 0],
            [2, 0],
          ],
        },
      ],
      10,
    );
    expect(objects).toHaveLength(1);
    expect(dropped).toBe(7);
    expect(objectsFromAi('kein Array', 10)).toEqual({ objects: [], dropped: 0 });
  });

  it('beschreibt den Plan in Metern', () => {
    const plan = planForAi(
      [
        {
          id: 'a',
          type: 'fence',
          points: [
            [0, 0],
            [500, 0],
          ],
        },
      ],
      50,
      [2000, 1500],
    );
    expect(plan.flaecheInMetern).toEqual({ breite: 40, hoehe: 30 });
    expect(plan.vorhandeneObjekte[0].points).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(plan.objektarten.lawn).toBe('Rasenfläche (area)');
  });
});
