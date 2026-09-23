import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

export class AuditLogQueryDto extends PageQueryDto {
  // z.B. "Invoice", "Quote", "User"
  @IsOptional()
  @IsString()
  @MaxLength(50)
  entity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  // z.B. "quote_status", "invoice_issue"
  @IsOptional()
  @IsString()
  @MaxLength(50)
  action?: string;
}
