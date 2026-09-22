import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { PermissionKey } from './permissions';
import { AuthenticatedRequest } from './authenticated-request';

// Diese Guard ist die eigentliche Sicherheitsbarriere. Sie läuft NACH dem
// JwtAuthGuard (der req.user setzt) und prüft, ob der eingeloggte User alle
// für die Route erforderlichen Permissions besitzt. Das Frontend kann
// Buttons/Menüs ausblenden, aber die tatsächliche Durchsetzung passiert hier.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true; // Route hat keine expliziten Anforderungen
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userPermissions = request.user?.permissions ?? [];

    const missing = required.filter((perm) => !userPermissions.includes(perm));
    if (missing.length > 0) {
      throw new ForbiddenException(`Fehlende Berechtigung(en): ${missing.join(', ')}`);
    }

    return true;
  }
}
