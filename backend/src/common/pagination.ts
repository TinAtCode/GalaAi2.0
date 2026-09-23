import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
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

export function pageArgs(page: PageQueryDto) {
  return { take: page.take ?? MAX_PAGE_SIZE, skip: page.skip ?? 0 };
}

export function withTotalCount<T>(res: Response, result: { items: T[]; total: number }): T[] {
  res.setHeader('X-Total-Count', String(result.total));
  return result.items;
}
