import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from '../utils/jwt';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.madyaw_token;

  const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;

  if (!token) {
    return res.status(401).json({ message: 'Please sign in to continue.' });
  }

  try {
    req.auth = verifyAuthToken(token);
    return next();
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
}

/**
 * Optional auth middleware — populates req.auth if a valid token is present,
 * but does NOT block the request if no token is provided.
 *
 * Use this on endpoints that serve both authenticated users and
 * unauthenticated guests (e.g. receipt lookups after guest checkout).
 * Route handlers must still apply their own ownership check.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.madyaw_token;

  const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;

  if (token) {
    try {
      req.auth = verifyAuthToken(token);
    } catch {
      // Invalid token — proceed unauthenticated; let the handler decide.
    }
  }

  return next();
}