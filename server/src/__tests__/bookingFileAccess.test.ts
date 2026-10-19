import './testSetup';
import {
  bookingFileHmacSignature,
  bookingFileLinkExpired,
  bookingFilePublicUrl,
  bookingFileUrl,
  newBookingFileToken,
  timingSafeEqualString,
} from '../utils/bookingFileAccess';

describe('bookingFileAccess', () => {
  it('expires ID/receipt links 60 days after check-out', () => {
    const checkOut = Date.parse('2026-01-01T00:00:00+08:00');
    expect(bookingFileLinkExpired('2026-01-01', checkOut + 59 * 86_400_000)).toBe(false);
    expect(bookingFileLinkExpired('2026-01-01', checkOut + 61 * 86_400_000)).toBe(true);
    expect(bookingFileLinkExpired(undefined)).toBe(false);
  });

  it('builds token URLs for hotel guest_id_url / payment_proof_url', () => {
    const token = newBookingFileToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const url = bookingFilePublicUrl('booking-1', 'payment-proof', token);
    expect(url).toContain('/bookings/booking-1/files/payment-proof?token=');
    expect(url).toContain(token);
  });

  it('falls back to HMAC sig when no token is provided', () => {
    process.env.JWT_SECRET = 'test-secret-for-booking-file-hmac';
    const url = bookingFileUrl('booking-1', 'valid-id');
    expect(url).toMatch(/\/files\/valid-id\?sig=[0-9a-f]{64}$/);
    const sig = bookingFileHmacSignature('booking-1', 'valid-id');
    expect(url).toContain(sig);
  });

  it('compares tokens in constant time', () => {
    const token = newBookingFileToken();
    expect(timingSafeEqualString(token, token)).toBe(true);
    expect(timingSafeEqualString(token, newBookingFileToken())).toBe(false);
  });
});
