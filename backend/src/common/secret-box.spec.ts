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

  it('32 Byte als Base64 werden direkt genommen', () => {
    process.env.SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
    const sealed = sealSecret('abc');
    process.env.SECRET_KEY = '07'.repeat(32); // derselbe Schlüssel als Hex
    expect(openSecret(sealed)).toBe('abc');
    // auch base64url (z.B. randomBytes(32).toString('base64url')) wie bisher
    process.env.SECRET_KEY = Buffer.alloc(32, 251).toString('base64url');
    const url = sealSecret('abc');
    process.env.SECRET_KEY = 'fb'.repeat(32);
    expect(openSecret(url)).toBe('abc');
  });

  it('Schlüssel aus ops/buero/start (48 zufällige Zeichen) funktionieren und sind stabil', () => {
    // früher: „SECRET_KEY muss 32 Byte lang sein“ – KI-Schlüssel und Push im Büro gingen nicht
    process.env.SECRET_KEY = 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hJ3';
    const sealed = sealSecret('sk-geheim');
    expect(openSecret(sealed)).toBe('sk-geheim');
    // derselbe Schlüssel auf dem Server (Umzug): lesbar; ein anderer: nicht
    process.env = { ...env, SECRET_KEY: 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hJ3' };
    expect(openSecret(sealed)).toBe('sk-geheim');
    process.env.SECRET_KEY = 'X'.repeat(48);
    expect(() => openSecret(sealed)).toThrow();
  });
});
