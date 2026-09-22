import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  // Optional: verknüpft den Mitarbeiter mit einem bestehenden Login-Account
  // (z.B. damit er seine eigene Zeiterfassung nutzen kann).
  @IsOptional()
  @IsString()
  userId?: string;
}
