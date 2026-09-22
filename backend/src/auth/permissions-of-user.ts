import { PrismaService } from '../prisma/prisma.service';

// Alle Permission-Keys eines Users aus allen seinen Rollen (dedupliziert).
export async function loadUserWithPermissions(
  prisma: PrismaService,
  where: { id: string } | { email: string },
) {
  const user = await prisma.user.findUnique({
    where,
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user) return null;

  const permissions = new Set<string>();
  for (const userRole of user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.key);
    }
  }
  return { user, permissions: Array.from(permissions) };
}
