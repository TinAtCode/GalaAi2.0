import { IsOptional, IsString, MinLength } from 'class-validator';

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
