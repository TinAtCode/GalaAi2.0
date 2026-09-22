import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const QUOTE_STATUSES = ['draft', 'approved', 'sent', 'accepted', 'rejected', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

class QuoteLineItemInputDto {
  @IsString()
  serviceId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyLaborRateOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadPercentOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  surchargePercentOverride?: number;
}

export class CreateQuoteDto {
  @IsString()
  projectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemInputDto)
  lineItems!: QuoteLineItemInputDto[];
}

// Kunden sagen "ja"/"nein" auf ein VERSENDETES Angebot – nur diese
// Zielzustände sind über diesen Endpunkt erlaubt (draft/approved/sent
// werden über eigene, permission-getrennte Endpunkte gesetzt).
export class SetQuoteOutcomeDto {
  @IsIn(['accepted', 'rejected', 'expired'])
  status!: 'accepted' | 'rejected' | 'expired';
}
