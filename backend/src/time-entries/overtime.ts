// Reine, deterministische Funktion (Punkt 14: KI interpretiert, Software
// berechnet) – bewusst einfaches Modell: EINE Regelarbeitszeit pro Tag statt
// komplexer Schichtpläne/Wochenmodelle (siehe STATUS.md, Punkt 29 nennt
// "später Arbeitszeitmodelle" als Ausblick, nicht als Anforderung für V1).
export interface OvertimeResult {
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
}

export function calculateOvertime(workedMinutes: number, regularDailyHours: number): OvertimeResult {
  const regularMinutes = regularDailyHours * 60;
  const overtimeMinutes = Math.max(0, workedMinutes - regularMinutes);
  return {
    workedMinutes: Math.round(workedMinutes),
    regularMinutes: Math.round(regularMinutes),
    overtimeMinutes: Math.round(overtimeMinutes),
  };
}
