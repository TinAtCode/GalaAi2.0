import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
