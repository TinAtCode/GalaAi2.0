import * as bcrypt from 'bcrypt';

export const PASSWORD_MIN_LENGTH = 10;

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

// E-Mail-Adressen sind unabhängig von Groß-/Kleinschreibung eindeutig.
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// Für DTOs: @Transform(trimEmail) vor @IsEmail(), damit ein Leerzeichen am
// Ende (Kopieren aus einer Mail) nicht als ungültige Adresse abgelehnt wird.
export const trimEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? normalizeEmail(value) : value;
