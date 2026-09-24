import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateCustomerDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // Rechnungsanschrift (ohne sie gilt die Anschrift des Objekts)
  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  city?: string;

  // Käuferreferenz der E-Rechnung (bei Behörden die Leitweg-ID)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  buyerReference?: string;

  // USt-IdNr., z.B. DE123456789 (für § 13b-Rechnungen als E-Rechnung)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatId?: string;

  // Unternehmer (Geschäftskunde) statt Verbraucher – für Verzugszinsen und
  // die Pauschale nach § 288 Abs. 5 BGB
  @IsOptional()
  @IsBoolean()
  isBusiness?: boolean;

  // Debitorenkonto (DATEV-Bereich 10000–69999). Ohne Angabe wird beim
  // Anlegen die nächste freie Nummer vergeben.
  @IsOptional()
  @IsInt()
  @Min(10000)
  @Max(69999)
  debtorNumber?: number;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
