import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Kontobewegungen: ?direction=debit&q=Aral&from=2026-01-01&to=2026-03-31&take=50&skip=0
export class ListTransactionsDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['credit', 'debit'])
  direction?: 'credit' | 'debit';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Matches(DAY, { message: 'from als Datum angeben, z.B. 2026-01-01.' })
  from?: string;

  @IsOptional()
  @Matches(DAY, { message: 'to als Datum angeben, z.B. 2026-03-31.' })
  to?: string;
}
