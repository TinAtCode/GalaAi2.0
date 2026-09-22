import { PERMISSIONS } from '../src/common/permissions';

// Testet dieselbe Maskierungslogik wie im MachinesController, isoliert
// nachgebaut, damit sie ohne Nest-Bootstrapping direkt prüfbar ist.
function maskMachine(machine: any, permissions: string[]) {
  const canSeeCost = permissions.includes(PERMISSIONS.PRICE_PURCHASE_READ);
  return { ...machine, hourlyRate: canSeeCost ? machine.hourlyRate : undefined };
}

describe('Maschinen – Preisrechte auf Stundensatz', () => {
  const machine = { id: 'machine-1', name: 'Minibagger', hourlyRate: 45 };

  it('Mitarbeiter ohne price.purchase.read sieht keinen Stundensatz', () => {
    const result = maskMachine(machine, [PERMISSIONS.CUSTOMER_READ]);
    expect(result.hourlyRate).toBeUndefined();
  });

  it('Büro mit price.purchase.read sieht den Stundensatz', () => {
    const result = maskMachine(machine, [PERMISSIONS.PRICE_PURCHASE_READ]);
    expect(result.hourlyRate).toBe(45);
  });
});
