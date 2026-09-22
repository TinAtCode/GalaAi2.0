import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export { QuoteStatus } from '@prisma/client';

class QuoteLineItemInputDto {
  @IsString()
  serviceId!: string;

  @IsNumber()
  @Min(0.01)
  @Max(1_000_000)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99_999_999.99)
  hourlyLaborRateOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  overheadPercentOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
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
