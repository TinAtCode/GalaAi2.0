import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Eine Zeile aus einer (bereits geparsten) Preisliste – woher die Zeilen
// kommen (CSV-Upload, OCR-Ergebnis, Lieferanten-API) ist für den
// Datenwächter irrelevant; er arbeitet nur auf diesen normalisierten Daten.
// Obergrenzen entsprechen den Datenbankspalten (Decimal(10,2)): größere Werte
// ergäben sonst einen Datenbankfehler (500) statt einer klaren 400-Meldung.
export class PriceListRowDto {
  @IsString()
  articleNumber!: string;

  @IsString()
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
}

export class AnalyzePriceListDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PriceListRowDto)
  rows!: PriceListRowDto[];
}

export class ApplyPriceListDto extends AnalyzePriceListDto {
  // Wenn gesetzt: nur Änderungen für genau diese Artikelnummern übernehmen
  // ("teilweise übernehmen", Punkt 16). Ohne dieses Feld: alles übernehmen
  // (bisheriges Verhalten bleibt der Standard).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acceptedArticleNumbers?: string[];
}
