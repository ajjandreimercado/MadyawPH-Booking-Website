import type { Request, Response, NextFunction } from 'express';

type UserRole = 'guest' | 'partner' | 'admin' | 'staff' | 'super_admin';

/**
 * Factory that creates a role-check middleware.
 * Usage: requireRole('admin', 'super_admin')
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const userRole = (req.auth as { role?: string }).role as UserRole | undefined;

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        message: `Access denied. Required role(s): ${roles.join(', ')}.`,
      });
    }

    return next();
  };
}

/**
 * Returns true if the role is privileged (admin/staff/super_admin).
 */
export function isPrivilegedRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'staff' || role === 'super_admin';
}
