/**
 * Guest Valid ID + payment screenshot links for the hotel app.
 *
 * Hotel walk-ins store guest_id_url on the booking (MADYAWPH chat/media).
 * Website bookings store bytes in Mongo and expose stable token URLs on
 * guest_id_url / payment_proof_url so MADYAWPH can open the same fields.
 *
 * Tokens live on booking_valid_ids / booking_payment_proofs and do not break
 * when JWT_SECRET is rotated (unlike the legacy HMAC ?sig= links).
 */

import crypto from 'crypto';
import { getMadyawApiPublicUrl } from '../config/env';

export type BookingFileKind = 'valid-id' | 'payment-proof';

export function newBookingFileToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Legacy HMAC (kept so older metadata links still work when JWT_SECRET is unchanged). */
export function bookingFileHmacSignature(bookingId: string, kind: BookingFileKind): string {
  const secret = (process.env.BOOKING_FILE_SECRET || process.env.JWT_SECRET || '').trim();
  return crypto
    .createHmac('sha256', secret)
    .update(`booking-file:${bookingId}:${kind}`)
    .digest('hex');
}

export function bookingFilePublicUrl(
  bookingId: string,
  kind: BookingFileKind,
  token: string,
): string {
  const params = new URLSearchParams({ token });
  return `${getMadyawApiPublicUrl()}/bookings/${encodeURIComponent(bookingId)}/files/${kind}?${params.toString()}`;
}

/** Prefer token URLs; fall back to HMAC when a token is not available yet. */
export function bookingFileUrl(
  bookingId: string,
  kind: BookingFileKind,
  token?: string | null,
): string {
  if (token && String(token).trim()) {
    return bookingFilePublicUrl(bookingId, kind, String(token).trim());
  }
  const params = new URLSearchParams({ sig: bookingFileHmacSignature(bookingId, kind) });
  return `${getMadyawApiPublicUrl()}/bookings/${encodeURIComponent(bookingId)}/files/${kind}?${params.toString()}`;
}

/** Guest IDs and receipts are only needed around the stay: links expire 60 days after check-out (Manila). */
export function bookingFileLinkExpired(checkOutDate: unknown, now = Date.now()): boolean {
  const day = String(checkOutDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return now > Date.parse(`${day}T00:00:00+08:00`) + 60 * 86_400_000;
}

export function timingSafeEqualString(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
