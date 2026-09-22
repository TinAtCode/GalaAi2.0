import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const DOCUMENT_TYPES = [
  'invoice',
  'quote',
  'delivery_note',
  'order_confirmation',
  'price_list',
  'catalog',
  'credit_note',
  'reminder',
  'purchase_order',
  'survey',
  'floor_plan',
  'customer_document',
  'site_document',
  'other',
] as const;

// Dieser Endpunkt registriert nur MITARBEITER-Metadaten zu einer Datei, die
// bereits an anderer Stelle in den Objektspeicher hochgeladen wurde (siehe
// Modellkommentar in schema.prisma) – kein tatsächlicher Datei-Upload hier.
export class CreateDocumentDto {
  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsString()
  @MinLength(1)
  storagePath!: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: (typeof DOCUMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  projectId?: string;
}
