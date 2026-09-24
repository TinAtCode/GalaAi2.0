import { BadRequestException } from '@nestjs/common';
import { CamtBalance, CamtEntry, CamtStatement } from './camt053';
import { withDedupeKeys } from './statement-keys';

// Kontoauszug im SWIFT-Format MT940 (wie ihn viele deutsche Banken und
// Buchhaltungsprogramme exportieren). Je Auszug:
//   :25: Konto (IBAN oder BLZ/Kontonummer)   :60F: Anfangssaldo
//   :61: Umsatzzeile  :86: Details (deutsche ?-Unterfelder)   :62F: Schlusssaldo
// Nur Euro-Konten; Salden mit Datum und Vorzeichen (C = Haben, D = Soll).

const TAG = /^:(\d{2}[A-Z]?):/;

interface Field {
  tag: string;
  value: string;
}

function fields(text: string): Field[] {
  const list: Field[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = TAG.exec(line);
    if (match) list.push({ tag: match[1], value: line.slice(match[0].length) });
    else if (line.trim() === '-' || line.startsWith('{') || line.startsWith('}')) continue;
    else if (list.length) list[list.length - 1].value += `\n${line}`;
  }
  return list;
}

// JJMMTT -> JJJJ-MM-TT (Jahrhundert: 20xx)
const day = (yymmdd: string) => `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
const amount = (raw: string) => Number(raw.replace(',', '.'));

// Saldo: C/D JJMMTT Währung Betrag
function balance(value: string, account: string | null): CamtBalance | 'foreign' | null {
  const match = /^([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(value.trim());
  if (!match || !account) return null;
  if (match[3] !== 'EUR') return 'foreign';
  const sum = amount(match[4]) * (match[1] === 'D' ? -1 : 1);
  return { accountIban: account, date: day(match[2]), amount: sum.toFixed(2) };
}

// Details (:86:) mit ?-Unterfeldern: ?20–?29 und ?60–?63 Verwendungszweck,
// ?31 Konto/IBAN, ?32/?33 Name. SEPA-Zweck steht hinter "SVWZ+".
function details(value: string) {
  const flat = value.replace(/\r?\n/g, '');
  const parts = new Map<string, string>();
  if (/^\d{3}\?/.test(flat)) {
    for (const match of flat.slice(3).matchAll(/\?(\d{2})([^?]*)/g)) {
      parts.set(match[1], (parts.get(match[1]) ?? '') + match[2]);
    }
  }
  if (!parts.size) return { remittance: flat.trim() || null, name: null, iban: null };
  const purpose = [...Array.from({ length: 10 }, (_, i) => `2${i}`), '60', '61', '62', '63']
    .map((k) => parts.get(k) ?? '')
    .join('');
  const svwz = /SVWZ\+(.*?)(?=(?:EREF|KREF|MREF|CRED|DEBT|ABWA|ABWE|COAM|OAMT|IBAN|BIC)\+|$)/.exec(purpose);
  const remittance = (svwz ? svwz[1] : purpose).replace(/\s+/g, ' ').trim();
  const name = `${parts.get('32') ?? ''}${parts.get('33') ?? ''}`.trim();
  const account = (parts.get('31') ?? '').replace(/\s/g, '');
  return {
    remittance: remittance || null,
    name: name || null,
    iban: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(account) ? account : null,
  };
}

export function parseMt940(text: string): CamtStatement {
  const all = fields(text);
  if (!all.some((f) => f.tag === '61') && !all.some((f) => f.tag.startsWith('62'))) {
    throw new BadRequestException(
      'Die Datei ist kein MT940-Kontoauszug (keine Umsätze oder Salden gefunden).',
    );
  }
  const entries: Omit<CamtEntry, 'dedupeKey'>[] = [];
  const balances: CamtBalance[] = [];
  const skipped = { notBooked: 0, foreignCurrency: 0 };
  let account: string | null = null;
  let euro = true;

  for (let i = 0; i < all.length; i++) {
    const { tag, value } = all[i];
    if (tag === '25') {
      const id = value.trim().replace(/\s/g, '');
      // IBAN oder BLZ/Kontonummer; Währung am Ende (z. B. "…EUR") entfernen
      account = id.replace(/EUR$/, '') || null;
    } else if (tag === '60F' || tag === '60M') {
      euro = !/^[CD]\d{6}(?!EUR)[A-Z]{3}/.test(value.trim());
    } else if (tag === '62F') {
      const b = balance(value, account);
      if (b === 'foreign') continue;
      if (b) balances.push(b);
    } else if (tag === '61') {
      // JJMMTT [MMTT] (R)C|D [Kapitalkennung] Betrag Buchungsschlüssel Referenz[//Bankreferenz]
      const match = /^(\d{6})(\d{4})?(R?[CD])([A-Z])?(\d+,\d*)/.exec(value.trim());
      if (!match) continue;
      if (!euro) {
        skipped.foreignCurrency++;
        continue;
      }
      const next = all[i + 1]?.tag === '86' ? details(all[i + 1].value) : null;
      const reversal = match[3].startsWith('R');
      // Storno einer Gutschrift (RC) ist eine Belastung und umgekehrt
      const credit = match[3].endsWith('C') !== reversal;
      entries.push({
        direction: credit ? 'credit' : 'debit',
        reversal,
        accountIban: account,
        bookingDate: day(match[1]),
        amount: amount(match[5]).toFixed(2),
        counterpartyName: next?.name ?? null,
        counterpartyIban: next?.iban ?? null,
        remittance: next?.remittance ?? null,
      });
    }
  }
  return { entries: withDedupeKeys('mt940', entries), balances, skipped };
}
