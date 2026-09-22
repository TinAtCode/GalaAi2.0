import { IsBoolean, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

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
  purchasePrice!: number;

  @IsNumber()
  @Min(0)
  salePrice!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
