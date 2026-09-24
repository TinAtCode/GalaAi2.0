import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { NormalizeUnit, QuantityRoundingFields } from '../../common/rounding.dto';

export class CreateArticleDto extends QuantityRoundingFields {
  @IsString()
  @MinLength(1)
  articleNumber!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @NormalizeUnit()
  @IsString()
  @MinLength(1)
  unit!: string;

  @IsNumber()
  @Min(0)
  @Max(99_999_999.99)
  purchasePrice!: number;

  @IsNumber()
  @Min(0)
  @Max(99_999_999.99)
  salePrice!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateArticleDto extends PartialType(CreateArticleDto) {}
