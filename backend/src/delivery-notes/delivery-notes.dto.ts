import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export class DeliveryNoteQueryDto {
  @IsOptional()
  @IsIn(['open', 'confirmed'])
  status?: 'open' | 'confirmed';
}

export class CreateDeliveryNoteDto {
  @IsUUID()
  documentId!: string;
}

// Bestätigen oder korrigieren: Lieferant, Projekt, Nummer, Datum
export class ConfirmDeliveryNoteDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  supplierId?: string | null;

  // keine UUID-Pflicht: die Demo-Daten haben sprechende IDs (demo-project-id)
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  projectId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  noteNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  noteDate?: string | null;
}

export class SupplierMailQueryDto {
  @IsString()
  @MaxLength(64)
  supplierId!: string;
}
