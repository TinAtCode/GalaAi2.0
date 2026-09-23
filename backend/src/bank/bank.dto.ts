import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// Bankumsatz einer Rechnung zuordnen; ohne Betrag der volle Umsatz
export class BookBankTransactionDto {
  @IsString()
  invoiceId!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  amount?: number;
}

export class ListBankTransactionsDto {
  @IsOptional()
  @IsIn(['open', 'booked', 'ignored'])
  status?: 'open' | 'booked' | 'ignored';
}
