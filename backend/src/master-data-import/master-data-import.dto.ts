import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EntityType, Mapping } from './entities';

const ENTITY_TYPES = ['customers', 'suppliers', 'articles', 'machines'];

// eingefügter Text, z.B. aus Excel kopiert (Tabs) oder eine CSV/JSON/vCard
export class ImportTextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  text!: string;
}

export class ImportPreviewDto {
  @IsIn(ENTITY_TYPES)
  entity!: EntityType;

  // Feld -> Spaltenname der Quelle (null = nicht übernehmen)
  @IsObject()
  mapping!: Mapping;
}

export class ImportApplyDto extends ImportPreviewDto {
  // Zeilennummern der Quelle (0 = erste Datenzeile)
  @IsArray()
  @ArrayMaxSize(5000)
  @IsInt({ each: true })
  @Min(0, { each: true })
  accept!: number[];
}
