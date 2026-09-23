import { Prisma } from '@prisma/client';
import { nextSequenceValue } from '../common/numbering';

// Debitorenkonten beginnen im DATEV-Standard bei 10000 (Sachkonten sind
// vierstellig, Personenkonten fünfstellig: 10000–69999 für Debitoren).
const FIRST_DEBTOR_NUMBER = 10000;
const LAST_DEBTOR_NUMBER = 69999;

// Nächste freie Debitorennummer der Firma. Der Zähler ist atomar (siehe
// nextSequenceValue); von Hand vergebene Nummern werden übersprungen.
export async function allocateDebtorNumber(tx: Prisma.TransactionClient, companyId: string) {
  for (;;) {
    const candidate = FIRST_DEBTOR_NUMBER - 1 + (await nextSequenceValue(tx, companyId, 'debtor', 0));
    if (candidate > LAST_DEBTOR_NUMBER) {
      throw new Error('Keine freie Debitorennummer mehr (10000–69999).');
    }
    const taken = await tx.customer.findFirst({
      where: { companyId, debtorNumber: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
}
