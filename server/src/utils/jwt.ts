import jwt, { type SignOptions } from 'jsonwebtoken';
import { JWT_EXPIRES_IN, JWT_SECRET } from '../config/env';

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: 'guest' | 'partner';
}

export function signAuthToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'] });
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}