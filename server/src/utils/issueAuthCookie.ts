import type { Response } from 'express';
import { signAuthToken, type AuthRole } from './jwt';

const COOKIE_NAME = 'madyaw_token';
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/**
 * Signs a JWT for the given user and sets it as an httpOnly cookie on the response.
 *
 * Single source of truth for cookie settings — any change here applies to
 * register, login, and Google OAuth simultaneously.
 *
 * CROSS-ORIGIN NOTE:
 *   The frontend (madyaw.com) and API (madyaw-api.onrender.com) are on different
 *   domains. For the auth cookie to be sent on cross-origin API requests:
 *   - sameSite must be 'none' (not 'strict' or 'lax')
 *   - secure must be true (required by browsers when sameSite=none)
 *   Both conditions are met in production (HTTPS + Render deployment).
 *
 * @returns The signed JWT string (useful for tests that need to inspect it).
 */
export function issueAuthCookie(
  res: Response,
  user: { userId: string; email: string; role: AuthRole },
): string {
  const token = signAuthToken({
    userId: user.userId,
    email: user.email,
    role: user.role,
  });

  const isProd = process.env.NODE_ENV === 'production';

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    // SameSite=none is required for cross-origin cookie delivery (frontend ↔ API on different domains).
    // SameSite=none REQUIRES secure=true — browsers reject it otherwise.
    // In dev (HTTP localhost) we fall back to 'lax' so the cookie still works.
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });

  return token;
}

export { COOKIE_NAME };
