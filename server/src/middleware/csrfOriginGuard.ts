/**
 * CSRF mitigation for cookie-based auth (SameSite=none on cross-origin SPA ↔ API).
 * Validates Origin/Referer on state-changing browser requests.
 * Server-to-server calls (webhooks, health checks, tests) typically send no Origin.
 */

import type { NextFunction, Request, Response } from 'express';
import { CLIENT_ORIGINS } from '../config/env';

const ALLOWED_ORIGINS = new Set(CLIENT_ORIGINS);

const WEBHOOK_PATH_PREFIXES = [
  '/api/messenger',
  '/api/bookings/hotel-events',
  '/api/hotels/payment-qr-cache',
];

function pathSkipsCsrf(path: string): boolean {
  if (WEBHOOK_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return /\/api\/hotels\/[^/]+\/payment-qr\/sync$/.test(path);
}

function originFromReferer(referer: string): string | null {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function csrfOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  if (pathSkipsCsrf(req.path)) {
    return next();
  }

  const origin = (req.headers.origin ?? '').trim();
  const refererOrigin = req.headers.referer ? originFromReferer(req.headers.referer) : null;

  // No browser context — webhooks, curl, automated tests.
  if (!origin && !refererOrigin) {
    return next();
  }

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return next();
  }

  if (refererOrigin && ALLOWED_ORIGINS.has(refererOrigin)) {
    return next();
  }

  return res.status(403).json({
    message: 'This action could not be completed from this page. Please use the Madyaw website and try again.',
  });
}
