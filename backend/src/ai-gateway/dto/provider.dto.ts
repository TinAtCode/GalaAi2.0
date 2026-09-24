import { AiProviderKind } from '@prisma/client';
import { AiCapability } from '../tasks';
import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAiProviderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsEnum(AiProviderKind)
  kind!: AiProviderKind;

  // OpenAI-kompatibel: bis einschließlich /v1; Anthropic: leer = api.anthropic.com;
  // Agent: die volle Adresse, an die GartenAI schickt
  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  // nur schreiben: wird verschlüsselt gespeichert und nie wieder ausgegeben
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(600)
  timeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(16)
  @Max(64_000)
  maxTokens?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemPrompt?: string;

  // was der Anbieter kann (Standard: nur Text)
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(['text', 'vision', 'image'], { each: true })
  capabilities?: AiCapability[];
}

export class UpdateAiProviderDto extends PartialType(CreateAiProviderDto) {
  // gespeicherten Schlüssel löschen
  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;
}

// Aufgabe einem Anbieter zuordnen (providerId null = Standard-Anbieter)
export class AssignTaskDto {
  @IsOptional()
  @IsString()
  providerId?: string | null;

  // anderes Modell als beim Anbieter eingestellt (z.B. kleines Modell für Zusammenfassungen)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string | null;
}
