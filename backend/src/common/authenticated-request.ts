import { Request } from 'express';

// Diese Struktur wird von der JwtStrategy aus dem Token gebaut. WICHTIG:
// companyId kommt IMMER aus dem verifizierten JWT, niemals aus einem vom
// Client mitgeschickten Feld (Body/Query) – das ist die Grundlage der
// Mandantentrennung in jedem Service.
export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  email: string;
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
