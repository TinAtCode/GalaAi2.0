import { readFileSync } from 'fs';
import { join } from 'path';
import { assertZipWithinLimits } from './zip-guard';

// Archiv nur aus Inhaltsverzeichnis: je Eintrag die angegebene entpackte Größe
function zipDirectory(sizes: number[]): Buffer {
  const entries = sizes.map((size, i) => {
    const name = Buffer.from(`f${i}.xml`);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    return Buffer.concat([header, name]);
  });
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sizes.length, 8);
  end.writeUInt16LE(sizes.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(0, 16);
  return Buffer.concat([directory, end]);
}

describe('ZIP-Grenzen (.xlsx)', () => {
  it('lässt eine echte Excel-Datei durch', () => {
    const xlsx = readFileSync(join(__dirname, '..', '..', 'test', 'fixtures', 'preisliste.xlsx'));
    expect(() => assertZipWithinLimits(xlsx)).not.toThrow();
  });

  it('lehnt ab, was entpackt zu groß wird', () => {
    expect(() => assertZipWithinLimits(zipDirectory([10, 20]), 100)).not.toThrow();
    expect(() => assertZipWithinLimits(zipDirectory([60, 60]), 100)).toThrow(/entpackt zu groß/);
    expect(() => assertZipWithinLimits(zipDirectory([0xffffffff]))).toThrow(/kein gültiges/);
  });

  it('lehnt kaputte Archive ab', () => {
    expect(() => assertZipWithinLimits(Buffer.from('PK kein Archiv'))).toThrow(/kein gültiges/);
    const broken = zipDirectory([10]);
    broken.writeUInt32LE(0, 0);
    expect(() => assertZipWithinLimits(broken)).toThrow(/kein gültiges/);
  });
});
