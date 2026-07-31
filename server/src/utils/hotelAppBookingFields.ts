/**
 * Helpers so website-created bookings match the hotel management app's
 * shared MongoDB document shape (verified against live hotel-created bookings).
 *
 * Hotel app reads (examples):
 *   guest_name, guest_email, check_in_date/check_out_date (Date @ Asia/Manila midnight),
 *   created_at, booking_type ("online"|"local"), booking_source, payment_method,
 *   summary_only (boolean required by reports)
 */

/** Parse yyyy-MM-dd as Asia/Manila start-of-day (matches hotel app Date storage). */
export function toStayDate(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    const fallback = new Date(dateStr);
    if (Number.isNaN(fallback.getTime())) {
      throw new Error(`Invalid stay date: ${dateStr}`);
    }
    return fallback;
  }
  // Hotel docs store e.g. 2026-08-01 local as 2026-07-31T16:00:00.000Z
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
}

export interface HotelAppBookingFields {
  guest_name: string;
  guest_email: string;
  check_in_date: Date;
  check_out_date: Date;
  created_at: Date;
  updated_at: Date;
  booking_type: 'online';
  booking_source: 'website-customer';
  payment_method: string;
  billing_mode: 'nightly';
  summary_only: boolean;
}

/**
 * Dual-write fields the hotel app expects alongside the website camelCase fields.
 */
export function buildHotelAppBookingFields(input: {
  guestName: string;
  guestEmail: string;
  checkInDate: string;
  checkOutDate: string;
  paymentMethod: string;
  now?: Date;
}): HotelAppBookingFields {
  const now = input.now ?? new Date();
  return {
    guest_name: input.guestName,
    guest_email: input.guestEmail,
    check_in_date: toStayDate(input.checkInDate),
    check_out_date: toStayDate(input.checkOutDate),
    created_at: now,
    updated_at: now,
    // Hotel UI maps booking_type === 'online' → "Online"; anything else often shows as "Local"
    booking_type: 'online',
    booking_source: 'website-customer',
    payment_method: input.paymentMethod,
    billing_mode: 'nightly',
    summary_only: false,
  };
}
