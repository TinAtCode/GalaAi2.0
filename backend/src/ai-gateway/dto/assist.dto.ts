import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class QuoteTextLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;
}

// Anschreiben zum Angebot: Positionen wie im Formular (auch vor dem Speichern)
export class QuoteTextDto {
  @IsString()
  @MaxLength(100)
  projectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuoteTextLineDto)
  lines!: QuoteTextLineDto[];

  // Wunsch an die KI, z.B. "kurz und förmlich"
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string;
}

export class SiteSummaryDto {
  @IsString()
  @MaxLength(100)
  projectId!: string;
}

export class PhotoDescriptionDto {
  @IsString()
  @MaxLength(100)
  documentId!: string;
}
