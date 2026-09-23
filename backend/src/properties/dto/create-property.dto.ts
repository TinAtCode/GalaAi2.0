import { IsOptional, IsString, MinLength } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/mapped-types';

export class CreatePropertyDto {
  @IsString()
  customerId!: string;

  @IsString()
  @MinLength(2)
  label!: string;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  city?: string;
}

// Das Objekt bleibt beim Kunden – customerId ist nicht änderbar.
export class UpdatePropertyDto extends PartialType(OmitType(CreatePropertyDto, ['customerId'] as const)) {}
