/**
 * rateLimiters.ts
 *
 * OWASP A04 (Insecure Design) / A07 (Authentication Failures) mitigation.
 * Centralised rate-limiter definitions — imported by app.ts and individual routes.
 *
 * Design decisions:
 *  - keyGenerator: prefers req.auth.userId for authenticated routes so
 *    users cannot bypass limits by rotating IPs.
 *  - handler: always sets a Retry-After header and returns a structured
 *    JSON body (graceful 429 — never a raw string).
 *  - Dev mode: limits are very high but never skipped, keeping limit logic
 *    reachable during local testing.
 *  - Prod mode: strict limits suited for a hotel booking API.
 */

import rateLimit, { type Options, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';

const isDev = process.env.NODE_ENV !== 'production';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Key generator that prefers an authenticated user ID over raw IP.
 * This prevents limit bypass by IP rotation on authenticated endpoints.
 */
function userOrIpKey(req: Request): string {
  const userId = (req as Request & { auth?: { userId?: string } }).auth?.userId;
  return userId ?? (req.ip ?? 'unknown');
}

/**
 * Graceful 429 handler — always sets Retry-After and returns structured JSON.
 * OWASP: a 429 response must not leak internal config; only expose reset time.
 */
function graceful429Handler(
  _req: Request,
  res: Response,
  _next: unknown,
  options: Options,
): void {
  const windowSeconds = Math.ceil((options.windowMs ?? 0) / 1000);
  res.setHeader('Retry-After', String(windowSeconds));
  res.status(429).json({
    status: 'error',
    message: (options.message as { message?: string })?.message ?? 'Too many requests.',
    retryAfter: windowSeconds,
  });
}

/** Factory so every limiter gets the same graceful handler with its own config. */
function makeLimiter(overrides: Partial<Options>): RateLimitRequestHandler {
  return rateLimit({
    standardHeaders: true,   // Emit RateLimit-* headers (RFC 6585)
    legacyHeaders: false,    // Suppress X-RateLimit-* (deprecated)
    keyGenerator: userOrIpKey,
    handler: graceful429Handler,
    ...overrides,
  });
}

// ─── Global API limiter — applied to all /api/* routes ───────────────────────
/**
 * Broad safety net for all endpoints.
 * Prod: 600 req / 15 min per user/IP.
 * Dev: 10 000 — high enough to never interfere, but NOT skipped.
 */
export const apiLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 10_000 : 600,
  message: { message: 'Too many requests. Please try again later.' },
});

// ─── Auth write limiter — login / register / google ──────────────────────────
/**
 * Strict limiter for authentication write endpoints.
 * Prod: 20 attempts / 15 min per user/IP — accounts for shared NAT.
 * Dev: 200 — keeps lockout logic reachable in tests without blocking dev.
 */
export const authWriteLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 200 : 20,
  message: { message: 'Too many authentication attempts. Please try again later.' },
});

// ─── Public read limiter — unauthenticated data endpoints ────────────────────
/**
 * Applied to GET /hotels, GET /properties, GET /room-categories.
 * Prevents data-scraping while keeping normal browsing well below the limit.
 * Prod: 300 req / 15 min. Dev: 5 000.
 */
export const publicReadLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 5_000 : 300,
  message: { message: 'Too many requests to this endpoint. Please try again later.' },
});

// ─── Availability check limiter ───────────────────────────────────────────────
/**
 * Applied to GET /bookings/availability (public, no auth).
 * Tighter limit to prevent booking-date enumeration attacks.
 * Prod: 60 req / 15 min. Dev: 1 000.
 */
export const availabilityLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 1_000 : 60,
  message: { message: 'Too many availability checks. Please try again later.' },
});

// ─── Review submission limiter ────────────────────────────────────────────────
/**
 * Applied to POST /reviews. Prevents review spam/abuse.
 * Prod: 10 submissions / 15 min. Dev: 100.
 */
export const reviewSubmitLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 100 : 10,
  message: { message: 'Too many review submissions. Please try again later.' },
});

/**
 * Guest booking create + Valid ID upload.
 * Tighter than the global limiter to reduce spam and memory pressure from multipart.
 * Prod: 10 creates / 15 min per IP. Dev: 200.
 */
export const bookingCreateLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 10,
  message: { message: 'Too many booking requests. Please try again later.' },
});

/**
 * Hotel-app webhook events. Keyed by IP (no user session).
 * Prod: 120 / 15 min. Dev: 2 000.
 */
export const hotelWebhookLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 2_000 : 120,
  keyGenerator: (req) => req.ip ?? 'unknown',
  message: { message: 'Too many hotel webhook events. Please try again later.' },
});

// ─── Password reset limiter (for future use) ─────────────────────────────────
/**
 * Extra-strict limiter for password reset endpoints (when implemented).
 * Prod: 5 req / hour. Dev: 100.
 */
export const passwordResetLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDev ? 100 : 5,
  message: { message: 'Too many password reset attempts. Please try again in an hour.' },
});
