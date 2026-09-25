import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  items!: string[];

  @IsOptional()
  @IsIn(['approved', 'archived'])
  status?: 'approved' | 'archived';
}

export class ReviewDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  // Einsatzplaner kann beim Prüfen Titel und Punkte noch anpassen
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  items?: string[];
}

export class CreateChecklistDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;
}

export class AddItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;
}

export class UpdateItemDto {
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text?: string;
}

export class CommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;
}

export class ProposeTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(2000)
  description?: string;
}
