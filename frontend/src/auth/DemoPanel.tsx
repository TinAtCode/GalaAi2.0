import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface DemoInfo {
  urls: string[];
  password: string;
  logins: { role: string; email: string }[];
}

// Nur in der Demo (Backend mit DEMO_MODE=1): Anmeldungen zum Antippen und ein
// QR-Code, mit dem sich Handys im selben WLAN verbinden. Im Betrieb liefert
// das Backend 404 und hier erscheint nichts.
export function DemoPanel({ onPick }: { onPick: (email: string, password: string) => void }) {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DemoInfo>('/demo/info')
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  // Handy-Adresse: die erste aus dem Startskript, sonst die aufgerufene (wenn nicht localhost)
  const here = window.location.origin;
  const phoneUrl = info?.urls[0] ?? (/localhost|127\.0\.0\.1/.test(here) ? null : here);

  useEffect(() => {
    if (!phoneUrl) return;
    // QR-Bibliothek erst hier laden: gehört nicht ins Startpaket
    void import('qrcode')
      .then((qrcode) => qrcode.toDataURL(phoneUrl, { margin: 1, width: 180 }))
      .then(setQr)
      .catch(() => undefined);
  }, [phoneUrl]);

  if (!info) return null;
  return (
    <section className="demo-panel" data-testid="demo-panel">
      <h2>Demo</h2>
      <p className="list-item-meta">Antippen zum Anmelden (Passwort {info.password}):</p>
      <div className="btn-row">
        {info.logins.map((login) => (
          <button
            key={login.email}
            type="button"
            className="btn btn-sm"
            onClick={() => onPick(login.email, info.password)}
            data-testid="demo-login"
          >
            {login.role}
          </button>
        ))}
      </div>
      {phoneUrl && (
        <div className="demo-phone">
          {qr && (
            <img src={qr} alt={`QR-Code für ${phoneUrl}`} width={180} height={180} data-testid="demo-qr" />
          )}
          <p className="list-item-meta">
            Handy im selben WLAN: QR-Code scannen oder <strong data-testid="demo-url">{phoneUrl}</strong>{' '}
            öffnen.
          </p>
          {info.urls.slice(1).map((url) => (
            <p key={url} className="list-item-meta">
              oder {url}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
