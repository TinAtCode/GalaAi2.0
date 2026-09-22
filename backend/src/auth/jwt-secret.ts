// Ohne gesetztes JWT_SECRET startet das Backend bewusst nicht. Ein fester
// Fallback-Wert wäre öffentlich bekannt (steht im Code) – damit könnte jeder
// ein Token mit beliebiger companyId und beliebigen Rechten selbst signieren.
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    throw new Error('JWT_SECRET ist nicht gesetzt – bitte in backend/.env eintragen (siehe .env.example).');
  }
  return secret;
}
