import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateArticleDto {
  @IsString()
  @MinLength(1)
  articleNumber!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
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
