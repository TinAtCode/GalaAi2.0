import { AiProviderKind } from '@prisma/client';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
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
}

export class UpdateAiProviderDto extends PartialType(CreateAiProviderDto) {
  // gespeicherten Schlüssel löschen
  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;
}
