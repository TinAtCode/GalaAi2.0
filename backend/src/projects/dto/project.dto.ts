import { IsEnum, IsString, MinLength } from 'class-validator';
import { ProjectStatus } from '@prisma/client';

export class CreateProjectDto {
  @IsString()
  propertyId!: string;

  @IsString()
  @MinLength(2)
  title!: string;
}

export class UpdateProjectStatusDto {
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;
}
