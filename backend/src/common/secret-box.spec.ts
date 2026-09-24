import { openSecret, sealSecret } from './secret-box';

describe('Geheimnisse verschlüsseln', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('ver- und entschlüsselt, jedes Mal anders', () => {
    process.env.JWT_SECRET = 'test-secret';
    delete process.env.SECRET_KEY;
    const a = sealSecret('sk-geheim');
    const b = sealSecret('sk-geheim');
    expect(a).not.toBe(b);
    expect(a).not.toContain('sk-geheim');
    expect(openSecret(a)).toBe('sk-geheim');
  });

  it('SECRET_KEY hat Vorrang; mit anderem Schlüssel oder verändert: Fehler', () => {
    process.env.SECRET_KEY = '11'.repeat(32);
    const sealed = sealSecret('abc');
    expect(openSecret(sealed)).toBe('abc');
    process.env.SECRET_KEY = '22'.repeat(32);
    expect(() => openSecret(sealed)).toThrow();
    process.env.SECRET_KEY = '11'.repeat(32);
    const parts = sealed.split(':');
    parts[3] = Buffer.from('xyz').toString('base64');
    expect(() => openSecret(parts.join(':'))).toThrow();
    process.env.SECRET_KEY = 'zu-kurz';
    expect(() => sealSecret('abc')).toThrow(/32 Byte/);
  });
});
