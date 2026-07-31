import jwt, { type SignOptions } from 'jsonwebtoken';
import { JWT_EXPIRES_IN, JWT_SECRET } from '../config/env';

export type AuthRole = 'guest' | 'partner' | 'admin' | 'staff' | 'super_admin';

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: AuthRole;
}

const ALLOWED_ROLES = new Set<AuthRole>(['guest', 'partner', 'admin', 'staff', 'super_admin']);

export function normalizeAuthRole(role: unknown): AuthRole {
  if (typeof role === 'string' && ALLOWED_ROLES.has(role as AuthRole)) {
    return role as AuthRole;
  }
  return 'guest';
}

export function signAuthToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'] });
}

export function verifyAuthToken(token: string) {
  const payload = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
  return {
    ...payload,
    role: normalizeAuthRole(payload.role),
  };
}
