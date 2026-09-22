import { IsBoolean, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateMachineDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsNumber()
  @Min(0)
  hourlyRate!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
