import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Response } from 'express';

// Listen liefern höchstens so viele Einträge auf einmal – ohne Grenze lädt
// jede Liste irgendwann tausende Zeilen in einem Rutsch.
export const MAX_PAGE_SIZE = 500;

// ?take=50&skip=100. Die Antwort bleibt ein Array; die Gesamtzahl steht im
// Header X-Total-Count, damit das Frontend "weitere laden" anbieten kann.
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

// Liste mit Suche: ?q=Müller (Groß-/Kleinschreibung egal), optional Status
export class SearchQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;
}

// Suchbegriff als Prisma-Bedingung "enthält" (null ohne Begriff)
export function contains(q: string | undefined) {
  const term = q?.trim();
  return term ? { contains: term, mode: 'insensitive' as const } : null;
}

export function pageArgs(page: PageQueryDto) {
  return { take: page.take ?? MAX_PAGE_SIZE, skip: page.skip ?? 0 };
}

export function withTotalCount<T>(res: Response, result: { items: T[]; total: number }): T[] {
  res.setHeader('X-Total-Count', String(result.total));
  return result.items;
}
