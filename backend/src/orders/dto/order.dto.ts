import { IsIn, IsString } from 'class-validator';

export const ORDER_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

export class CreateOrderDto {
  @IsString()
  quoteId!: string;
}

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES)
  status!: (typeof ORDER_STATUSES)[number];
}
