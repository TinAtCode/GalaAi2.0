import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateSupplierDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // unsere Kundennummer beim Lieferanten
  @IsOptional()
  @IsString()
  @MaxLength(60)
  customerNumber?: string;

  // Wörter, an denen Lieferscheine erkannt werden (Firmierung, USt-IdNr. …)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  matchTerms?: string[];
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
