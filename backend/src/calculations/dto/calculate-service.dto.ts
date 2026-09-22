import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CalculateServiceDto {
  @IsString()
  serviceId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  // Überschreibt die Firmen-Grundwerte für diese eine Berechnung (z.B. für
  // ein Angebot mit Sonderkonditionen) – macht die Kalkulation konfigurierbar
  // statt starr fest programmiert (siehe Punkt 20 im Ursprungsdokument).
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyLaborRateOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadPercentOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  surchargePercentOverride?: number;
}
