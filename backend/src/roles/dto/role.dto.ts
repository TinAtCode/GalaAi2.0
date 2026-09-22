import { ArrayUnique, IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  // Permission-Keys, z.B. ["customer.read", "price.sale.read"].
  // Unbekannte Keys werden vom Service ignoriert (kein stiller Fehler,
  // siehe RolesService.resolvePermissionIds).
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys?: string[];
}

export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class AssignRoleDto {
  @IsString()
  userId!: string;
}
