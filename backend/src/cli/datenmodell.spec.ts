import { readFileSync } from 'fs';
import { load, OUTPUT, render, schemaComments, tenantGuards } from './datenmodell';

describe('DATENMODELL.md', () => {
  it('passt zum Schema (sonst: cd backend && npm run docs:datenmodell)', () => {
    const { schema, migrations } = load(`${__dirname}/../..`);
    expect(readFileSync(OUTPUT, 'utf8')).toBe(render(schema, migrations));
  });

  it('liest Kommentare über Tabellen und Feldern', () => {
    const c = schemaComments(
      [
        '// Kunde',
        'model Customer {',
        '  id String @id',
        '  // Anzeigename',
        '  name String // Pflicht',
        '}',
      ].join('\n'),
    );
    expect(c.models.get('Customer')).toBe('Kunde');
    expect(c.fields.get('Customer.name')).toBe('Anzeigename Pflicht');
    expect(c.fields.has('Customer.id')).toBe(false);
  });

  it('nimmt je Tabelle den zuletzt angelegten tenant_guard', () => {
    const guards = tenantGuards([
      `CREATE TRIGGER a BEFORE INSERT ON "Quote" FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project');`,
      `CREATE TRIGGER a BEFORE INSERT OR UPDATE ON "Quote" FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'copiedFromId:Quote');`,
    ]);
    expect(guards.get('Quote')).toEqual(['projectId:Project', 'copiedFromId:Quote']);
  });
});
