import { IsNumber, IsString, Max, Min } from 'class-validator';

export class RecordMaterialUsageDto {
  @IsString()
  projectId!: string;

  @IsString()
  articleId!: string;

  @IsNumber()
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;
}
