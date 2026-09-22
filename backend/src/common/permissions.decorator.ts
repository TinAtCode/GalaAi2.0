import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from './permissions';

export const PERMISSIONS_KEY = 'requiredPermissions';

// Beispiel: @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
