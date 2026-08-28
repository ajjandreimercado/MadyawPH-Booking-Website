import crypto from 'crypto';
import type { Request } from 'express';
import { getHotelWebhookSecret } from '../config/env';

function timingSafeEqualString(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function isHotelWebhookAuthorized(req: Request): boolean {
  const secret = getHotelWebhookSecret();
  if (!secret) return false;
  const header = req.header('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const alt = (req.header('x-madyaw-hotel-secret') ?? '').trim();
  const provided = bearer || alt;
  if (!provided) return false;
  return timingSafeEqualString(provided, secret);
}
