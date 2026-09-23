import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';

// Eine Kontobewegung aus dem Kontoauszug: Gutschrift (Zahlungseingang) oder
// Abbuchung. Gegenpartei ist bei Gutschriften der Zahler, bei Abbuchungen der
// Empfänger.
export interface CamtEntry {
  dedupeKey: string; // eindeutig je Umsatz (Bankreferenz), gegen doppeltes Einlesen
  direction: 'credit' | 'debit';
  // Rückbuchung (RvslInd): z.B. zurückgegebene Lastschrift oder zurückgekommene
  // Überweisung – kein neuer Zahlungseingang und keine neue Ausgabe
  reversal: boolean;
  accountIban: string | null;
  bookingDate: string; // JJJJ-MM-TT
  amount: string; // "123.45", immer positiv – die Richtung steht in direction
  counterpartyName: string | null;
  counterpartyIban: string | null;
  remittance: string | null; // Verwendungszweck
}

// Gebuchter Schlusssaldo (CLBD) eines Kontos zu einem Tag
export interface CamtBalance {
  accountIban: string;
  date: string; // JJJJ-MM-TT
  amount: string; // "-123.45" bei Soll-Saldo
}

export interface CamtStatement {
  entries: CamtEntry[];
  balances: CamtBalance[];
  // übersprungen: nicht gebuchte und Fremdwährungs-Umsätze
  skipped: { notBooked: number; foreignCurrency: number };
}

type Node = Record<string, unknown>;
const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') {
    const inner = (value as Node)['#text'];
    return inner === undefined ? null : String(inner).trim();
  }
  return String(value).trim();
};
const path = (node: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>(
    (current, key) => (current && typeof current === 'object' ? (current as Node)[key] : undefined),
    node,
  );

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  // keine Entity-Auflösung (Schutz gegen Entity-Expansion); DOCTYPE wird vorher abgelehnt
  processEntities: false,
  parseTagValue: false,
  isArray: (name) => ['Stmt', 'Ntry', 'TxDtls', 'Ustrd', 'Bal'].includes(name),
});

// Kontoauszug im Format ISO 20022 camt.053 (Versionen 001.02 bis 001.13;
// in Deutschland üblich: .02 bis Ende 2025, danach .08). Übernommen werden
// gebuchte Umsätze in EUR (Gutschriften und Abbuchungen) und die gebuchten
// Schlusssalden der Konten.
export function parseCamt053(xml: string): CamtStatement {
  if (/<!DOCTYPE/i.test(xml)) {
    throw new BadRequestException('Ungültiger Kontoauszug (DOCTYPE ist nicht erlaubt).');
  }
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    throw new BadRequestException('Die Datei ist kein gültiges XML.');
  }
  const root = doc.Document as Node | undefined;
  // Der Parser entfernt Namespaces – daher aus dem Document-Tag selbst lesen;
  // dort können weitere Namespaces stehen (z.B. xmlns:xsi), auch vor dem camt
  const documentTag = /<(?:[\w-]+:)?Document\b[^>]*>/.exec(xml)?.[0] ?? '';
  const namespaces = [...documentTag.matchAll(/\bxmlns(?::[\w-]+)?\s*=\s*(["'])(.*?)\1/g)].map((m) => m[2]);
  const isCamt053 = namespaces.some((ns) => ns.startsWith('urn:iso:std:iso:20022:tech:xsd:camt.053.'));
  const statements = asArray(path(root, 'BkToCstmrStmt', 'Stmt') as Node | Node[] | undefined);
  if (!root || !isCamt053 || statements.length === 0) {
    throw new BadRequestException('Die Datei ist kein Kontoauszug im Format CAMT.053.');
  }

  const entries: CamtEntry[] = [];
  const balances: CamtBalance[] = [];
  const skipped = { notBooked: 0, foreignCurrency: 0 };
  for (const statement of statements) {
    const accountIban = text(path(statement, 'Acct', 'Id', 'IBAN'));
    // Schlusssaldo (CLBD = closing booked); Soll-Saldo negativ
    for (const balance of asArray(statement.Bal as Node | Node[] | undefined)) {
      if (text(path(balance, 'Tp', 'CdOrPrtry', 'Cd')) !== 'CLBD' || !accountIban) continue;
      const amt = balance.Amt as Node | undefined;
      const value = Number(text(amt));
      const date = (text(path(balance, 'Dt', 'Dt')) ?? text(path(balance, 'Dt', 'DtTm')) ?? '').slice(0, 10);
      if (
        String(amt?.['@Ccy'] ?? 'EUR') !== 'EUR' ||
        !Number.isFinite(value) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      )
        continue;
      const signed = text(balance.CdtDbtInd) === 'DBIT' ? -value : value;
      balances.push({ accountIban, date, amount: signed.toFixed(2) });
    }
    // Kennung des Auszugs (von der Bank vergeben) für Umsätze ohne Bankreferenz
    const statementId = text(statement.Id) ?? text(statement.ElctrncSeqNb) ?? '';
    asArray(statement.Ntry as Node | Node[] | undefined).forEach((entry, entryIndex) => {
      const indicator = text(entry.CdtDbtInd);
      if (indicator !== 'CRDT' && indicator !== 'DBIT') return;
      const direction = indicator === 'CRDT' ? 'credit' : 'debit';
      const reversal = text(entry.RvslInd) === 'true';
      // Gegenpartei: bei Gutschriften der Zahler (Dbtr), bei Abbuchungen der
      // Empfänger (Cdtr). Bei einer Rückbuchung bleiben die Rollen der
      // ursprünglichen Zahlung – die Gegenpartei steht dann in der anderen.
      const party = (direction === 'credit') !== reversal ? 'Dbtr' : 'Cdtr';
      // v02: <Sts>BOOK</Sts>, ab v08: <Sts><Cd>BOOK</Cd></Sts>
      const status = text(path(entry, 'Sts', 'Cd')) ?? text(entry.Sts);
      if (status !== 'BOOK') {
        skipped.notBooked++;
        return;
      }
      const bookingDate = (
        text(path(entry, 'BookgDt', 'Dt')) ??
        text(path(entry, 'BookgDt', 'DtTm')) ??
        ''
      ).slice(0, 10);
      const entryRef = text(entry.AcctSvcrRef);
      const details = asArray(path(entry, 'NtryDtls', 'TxDtls') as Node | Node[] | undefined);
      // Sammelbuchung mit Einzelbeträgen: je Transaktion ein Zahlungseingang
      const parts: { amount: unknown; tx: Node | undefined }[] =
        details.length > 1 &&
        details.every(
          (tx) => path(tx, 'Amt') !== undefined || path(tx, 'AmtDtls', 'TxAmt', 'Amt') !== undefined,
        )
          ? details.map((tx) => ({ amount: path(tx, 'Amt') ?? path(tx, 'AmtDtls', 'TxAmt', 'Amt'), tx }))
          : [{ amount: entry.Amt, tx: details[0] }];

      parts.forEach(({ amount, tx }, index) => {
        const currency = String((amount as Node | undefined)?.['@Ccy'] ?? 'EUR');
        if (currency !== 'EUR') {
          skipped.foreignCurrency++;
          return;
        }
        const value = Number(text(amount));
        if (!Number.isFinite(value) || value <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) return;
        // v02: Dbtr/Nm, ab v08: Dbtr/Pty/Nm (Cdtr entsprechend)
        const counterpartyName =
          text(path(tx, 'RltdPties', party, 'Pty', 'Nm')) ?? text(path(tx, 'RltdPties', party, 'Nm'));
        const counterpartyIban = text(path(tx, 'RltdPties', `${party}Acct`, 'Id', 'IBAN'));
        const remittance =
          asArray(path(tx, 'RmtInf', 'Ustrd') as unknown[] | undefined)
            .map(text)
            .filter(Boolean)
            .join(' ') || null;
        // Dublettenschlüssel: Bankreferenz des Umsatzes (bei Sammelbuchungen
        // mit laufender Nummer), sonst die Bankreferenz der Transaktion. Ohne
        // beides: Auszugskennung + Position im Auszug + Merkmale – derselbe
        // Auszug ergibt so dieselben Schlüssel, zwei gleiche Überweisungen
        // am selben Tag bleiben aber zwei Umsätze. Die EndToEndId wählt der
        // Zahler selbst (oft die Rechnungsnummer) und ist daher nicht eindeutig.
        const txRef = text(path(tx, 'Refs', 'AcctSvcrRef'));
        const key = entryRef
          ? parts.length === 1
            ? entryRef
            : `${entryRef}/${index}`
          : (txRef ??
            createHash('sha256')
              .update(
                [
                  statementId,
                  entryIndex,
                  index,
                  bookingDate,
                  value.toFixed(2),
                  counterpartyName,
                  counterpartyIban,
                  remittance,
                  text(path(tx, 'Refs', 'EndToEndId')),
                ].join('|'),
              )
              .digest('hex'));
        entries.push({
          dedupeKey: `${accountIban ?? ''}|${key}`,
          direction,
          reversal,
          accountIban,
          bookingDate,
          amount: value.toFixed(2),
          counterpartyName,
          counterpartyIban,
          remittance,
        });
      });
    });
  }
  return { entries, balances, skipped };
}

// Rechnungsnummern im Verwendungszweck: "R-2026-0001", auch "R 2026 0001",
// "R20260001" oder "RE-2026-0001" -> normalisiert "R-2026-0001". Die laufende
// Nummer hat mindestens vier Stellen (ab 10000 fünf, siehe numbering.ts).
export function invoiceNumbersIn(remittance: string | null): string[] {
  if (!remittance) return [];
  const found = new Set<string>();
  for (const match of remittance.matchAll(/\bRE?\s*[-/]?\s*(\d{4})\s*[-/]?\s*(\d{4,})\b/gi)) {
    found.add(`R-${match[1]}-${match[2]}`);
  }
  return [...found];
}
