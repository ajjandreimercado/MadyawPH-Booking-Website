import type { Request, Response, NextFunction } from 'express';

const startTime = Date.now();

/**
 * Lightweight request logger — outputs method, path, status, and duration.
 * Replaces the need for morgan while staying dependency-free.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const begin = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - begin;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    // Mask sensitive query strings (e.g. token=)
    const url = req.originalUrl.replace(/([?&](?:token|password|secret)=)[^&]*/gi, '$1[REDACTED]');
    console.log(`[${level}] ${req.method} ${url} → ${res.statusCode} (${ms}ms)`);
  });

  next();
}

/** Returns the number of milliseconds the process has been running. */
export function getUptimeMs() {
  return Date.now() - startTime;
}
