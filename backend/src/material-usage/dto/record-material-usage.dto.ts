import { IsNumber, IsString, Min } from 'class-validator';

export class RecordMaterialUsageDto {
  @IsString()
  projectId!: string;

  @IsString()
  articleId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}
