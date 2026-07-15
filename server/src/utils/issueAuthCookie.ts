import type { Response } from 'express';
import { signAuthToken } from './jwt';

const COOKIE_NAME = 'madyaw_token';
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/**
 * Signs a JWT for the given user and sets it as an httpOnly cookie on the response.
 *
 * Single source of truth for cookie settings — any change here applies to
 * register, login, and Google OAuth simultaneously.
 *
 * @returns The signed JWT string (useful for tests that need to inspect it).
 */
export function issueAuthCookie(
  res: Response,
  user: { userId: string; email: string; role: 'guest' | 'partner' },
): string {
  const token = signAuthToken({
    userId: user.userId,
    email: user.email,
    role: user.role,
  });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    // Secure cookies only in production — dev over HTTP would block the cookie otherwise.
    secure: process.env.NODE_ENV === 'production',
    // 'strict' in production (prevents CSRF via cross-site requests);
    // 'lax' in dev so the OAuth redirect from accounts.google.com carries the cookie.
    sameSite: (process.env.NODE_ENV === 'production' ? 'strict' : 'lax') as 'strict' | 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });

  return token;
}

export { COOKIE_NAME };
