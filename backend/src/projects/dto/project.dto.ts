import { IsIn, IsString, MinLength } from 'class-validator';

export const PROJECT_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

export class CreateProjectDto {
  @IsString()
  propertyId!: string;

  @IsString()
  @MinLength(2)
  title!: string;
}

export class UpdateProjectStatusDto {
  @IsIn(PROJECT_STATUSES)
  status!: (typeof PROJECT_STATUSES)[number];
}
