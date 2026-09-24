import { AbsenceKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAbsenceDto {
  @IsUUID()
  userId!: string;

  @IsEnum(AbsenceKind)
  kind!: AbsenceKind;

  @Matches(DAY, { message: 'startDate als Datum angeben, z.B. 2026-10-05.' })
  startDate!: string;

  @Matches(DAY, { message: 'endDate als Datum angeben, z.B. 2026-10-09.' })
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AbsenceQueryDto {
  @Matches(DAY, { message: 'from als Datum angeben, z.B. 2026-10-01.' })
  from!: string;

  @Matches(DAY, { message: 'to als Datum angeben, z.B. 2026-10-31.' })
  to!: string;
}
