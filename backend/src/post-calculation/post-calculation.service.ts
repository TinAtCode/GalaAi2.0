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
  labor: DeviationResult; // in Minuten
  material: DeviationResult; // in Euro (Einkaufspreis-Basis)
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

    // Soll: aus dem (falls vorhandenen) Auftrag -> Angebot -> Positionen ->
    // Dienstleistungs-Rezeptur die geplante Arbeitszeit UND den geplanten
    // Materialeinsatz je Einheit ableiten.
    // HINWEIS (siehe STATUS.md): das ist die AKTUELLE Rezeptur, kein
    // Snapshot zum Angebotszeitpunkt.
    const order = await this.prisma.order.findFirst({
      where: { projectId, companyId },
      include: { quote: { include: { lineItems: true } } },
    });

    const plannedLaborItems: PlannedLaborItem[] = [];
    const plannedMaterialItems: PlannedMaterialItem[] = [];

    if (order) {
      const relevantLineItems = order.quote.lineItems.filter((li: any) => li.serviceId);
      const services = await Promise.all(
        relevantLineItems.map((li: any) =>
          this.prisma.service.findFirst({
            where: { id: li.serviceId, companyId },
            include: { components: { include: { article: true } } },
          }),
        ),
      );
      relevantLineItems.forEach((lineItem: any, index: number) => {
        const service = services[index];
        if (!service) return;
        const quantity = Number(lineItem.quantity);

        const laborMinutesPerUnit = service.components.reduce(
          (sum: number, c: any) => sum + (c.laborMinutes ?? 0),
          0,
        );
        plannedLaborItems.push({ quantity, laborMinutesPerUnit });

        const materialCostPerUnit = service.components.reduce(
          (sum: number, c: any) =>
            sum + (c.article ? Number(c.quantityPer) * Number(c.article.purchasePrice) : 0),
          0,
        );
        plannedMaterialItems.push({ quantity, materialCostPerUnit });
      });
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

    return {
      labor: calculateDeviation(sumPlannedMinutes(plannedLaborItems), actualMinutes),
      material: calculateDeviation(sumPlannedMaterialCost(plannedMaterialItems), actualMaterialCost),
    };
  }
}
