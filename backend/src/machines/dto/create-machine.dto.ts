import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateMachineDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsNumber()
  @Min(0)
  @Max(99_999_999.99)
  hourlyRate!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
