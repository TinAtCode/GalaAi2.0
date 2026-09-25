import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DeviationResult {
  planned: number;
  actual: number;
  deviationAbs: number;
  // null, wenn keine Sollgröße vorliegt (z.B. noch kein Auftrag) – Division
  // durch 0 wird bewusst nicht als 0% oder Infinity ausgewiesen.
  deviationPercent: number | null;
}

export interface PostCalculationResult {
  orders: number; // Anzahl berücksichtigter Aufträge
  labor: DeviationResult; // in Minuten
  material: DeviationResult; // in Euro (Einkaufspreis-Basis)
  // dem Projekt zugeordnete Eingangsrechnungen (Einkauf, Fremdleistung), netto
  purchases: { count: number; net: number };
  margin: MarginResult;
}

// Deckungsbeitrag: Umsatz (ausgestellte Rechnungen netto) minus Lohn,
// Material und Eingangsrechnungen. Lohn zum Kalkulations-Stundensatz der
// Firma (enthält Lohnnebenkosten, wie im Angebot kalkuliert).
export interface MarginResult {
  orderValue: number; // Summe der Aufträge (netto)
  invoiced: number; // ausgestellte Rechnungen netto, Stornos abgezogen
  costs: { labor: number; material: number; purchases: number; total: number };
  hourlyRate: number;
  contribution: number; // invoiced - costs.total
  contributionPercent: number | null; // bezogen auf den Umsatz
}

export function calculateMargin(input: {
  orderValue: number;
  invoiced: number;
  laborMinutes: number;
  hourlyRate: number;
  material: number;
  purchases: number;
}): MarginResult {
  const labor = round2((input.laborMinutes / 60) * input.hourlyRate);
  const material = round2(input.material);
  const purchases = round2(input.purchases);
  const total = round2(labor + material + purchases);
  const invoiced = round2(input.invoiced);
  const contribution = round2(invoiced - total);
  return {
    orderValue: round2(input.orderValue),
    invoiced,
    costs: { labor, material, purchases, total },
    hourlyRate: input.hourlyRate,
    contribution,
    contributionPercent: invoiced > 0 ? round2((contribution / invoiced) * 100) : null,
  };
}

// Reine, deterministische Funktion (Punkt 14: KI interpretiert, Software
// berechnet) – direkt testbar ohne DB-Mock, für Arbeitszeit UND Material
// gleichermaßen nutzbar, da die Abweichungslogik identisch ist.
export function calculateDeviation(planned: number, actual: number): DeviationResult {
  const plannedRounded = round2(planned);
  const actualRounded = round2(actual);
  const deviationAbs = round2(actualRounded - plannedRounded);
  const deviationPercent = plannedRounded > 0 ? round2((deviationAbs / plannedRounded) * 100) : null;
  return { planned: plannedRounded, actual: actualRounded, deviationAbs, deviationPercent };
}

export interface PlannedLaborItem {
  quantity: number;
  laborMinutesPerUnit: number;
}
export interface PlannedMaterialItem {
  quantity: number;
  materialCostPerUnit: number;
}

export function sumPlannedMinutes(items: PlannedLaborItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.laborMinutesPerUnit, 0);
}
export function sumPlannedMaterialCost(items: PlannedMaterialItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.materialCostPerUnit, 0);
}

@Injectable()
export class PostCalculationService {
  constructor(private prisma: PrismaService) {}

  async calculateForProject(companyId: string, projectId: string): Promise<PostCalculationResult> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }

    // Soll: aus dem (falls vorhandenen) Auftrag -> Angebot -> Positionen
    // die geplante Arbeitszeit UND den geplanten Materialeinsatz je Einheit.
    // Alle nicht stornierten Aufträge zählen (z.B. Hauptauftrag und Nachtrag)
    const orders = await this.prisma.order.findMany({
      where: { projectId, companyId, status: { not: 'cancelled' } },
      include: { quote: { include: { lineItems: true } } },
    });

    const plannedLaborItems: PlannedLaborItem[] = [];
    const plannedMaterialItems: PlannedMaterialItem[] = [];

    for (const order of orders) {
      // Soll bevorzugt aus dem eingefrorenen Angebot (Stand zum Zeitpunkt des
      // Angebots). Nur für ältere Positionen ohne Snapshot wird auf die
      // aktuelle Rezeptur zurückgegriffen.
      const lineItems = order.quote.lineItems;
      const legacyItems = lineItems.filter(
        (li) =>
          li.serviceId && (li.plannedLaborMinutesPerUnit == null || li.plannedMaterialCostPerUnit == null),
      );
      const legacyServices = await Promise.all(
        legacyItems.map((li) =>
          this.prisma.service.findFirst({
            where: { id: li.serviceId!, companyId },
            include: { components: { include: { article: true } } },
          }),
        ),
      );
      const recipeByLineItem = new Map(legacyItems.map((li, index) => [li.id, legacyServices[index]]));

      for (const lineItem of lineItems) {
        // Soll aus der genauen Menge – die gerundete (z.B. aufgerundetes
        // Material) steht nur auf dem Angebot
        const quantity = Number(lineItem.quantityExact ?? lineItem.quantity);
        if (lineItem.plannedLaborMinutesPerUnit != null && lineItem.plannedMaterialCostPerUnit != null) {
          plannedLaborItems.push({ quantity, laborMinutesPerUnit: lineItem.plannedLaborMinutesPerUnit });
          plannedMaterialItems.push({
            quantity,
            materialCostPerUnit: Number(lineItem.plannedMaterialCostPerUnit),
          });
          continue;
        }
        const service = recipeByLineItem.get(lineItem.id);
        if (!service) continue;
        plannedLaborItems.push({
          quantity,
          laborMinutesPerUnit: service.components.reduce((sum, c) => sum + (c.laborMinutes ?? 0), 0),
        });
        plannedMaterialItems.push({
          quantity,
          materialCostPerUnit: service.components.reduce(
            (sum, c) => sum + (c.article ? Number(c.quantityPer) * Number(c.article.purchasePrice) : 0),
            0,
          ),
        });
      }
    }

    // Ist Arbeitszeit: alle abgeschlossenen/freigegebenen Zeiteinträge.
    const timeEntries = await this.prisma.timeEntry.findMany({
      where: { projectId, companyId, status: { in: ['completed', 'approved'] } },
    });
    const actualMinutes = timeEntries.reduce((sum: number, entry: any) => {
      if (!entry.endTime) return sum;
      const durationMs = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
      const minutes = durationMs / 60000 - (entry.breakMinutes ?? 0);
      return sum + Math.max(0, minutes);
    }, 0);

    // Ist Material: alle gebuchten Materialverbräuche, bewertet zum
    // AKTUELLEN Einkaufspreis (keine Snapshot-Bewertung zum Buchungszeitpunkt
    // – dieselbe bewusste Vereinfachung wie bei der Soll-Seite, siehe STATUS.md).
    const usages = await this.prisma.projectMaterialUsage.findMany({
      where: { projectId, companyId },
      include: { article: true },
    });
    const actualMaterialCost = usages.reduce(
      (sum: number, usage: any) => sum + Number(usage.quantity) * Number(usage.article.purchasePrice),
      0,
    );

    // Ist Einkauf: Eingangsrechnungen am Projekt (ohne stornierte), netto –
    // ohne Nettobetrag zählt der Rechnungsbetrag
    const payables = await this.prisma.incomingInvoice.findMany({
      where: { projectId, companyId, status: { not: 'cancelled' } },
      select: { amount: true, netAmount: true },
    });
    const purchasesNet = payables.reduce((sum, p) => sum + Number(p.netAmount ?? p.amount), 0);

    // Umsatz: ausgestellte Rechnungen; Schlussrechnungen ziehen Abschläge
    // schon ab, stornierte Rechnungen stehen auf "cancelled"
    const [invoices, company] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { projectId, companyId, status: 'issued', kind: { not: 'cancellation' } },
        select: { totalNet: true },
      }),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { hourlyLaborRate: true } }),
    ]);
    const margin = calculateMargin({
      orderValue: orders.reduce((sum, o) => sum + Number(o.quote.totalNet), 0),
      invoiced: invoices.reduce((sum, i) => sum + Number(i.totalNet), 0),
      laborMinutes: actualMinutes,
      hourlyRate: Number(company.hourlyLaborRate),
      material: actualMaterialCost,
      purchases: purchasesNet,
    });

    return {
      orders: orders.length,
      purchases: { count: payables.length, net: round2(purchasesNet) },
      margin,
      labor: calculateDeviation(sumPlannedMinutes(plannedLaborItems), actualMinutes),
      material: calculateDeviation(sumPlannedMaterialCost(plannedMaterialItems), actualMaterialCost),
    };
  }
}
