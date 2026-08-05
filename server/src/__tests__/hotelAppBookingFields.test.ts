import { buildHotelAppBookingFields, toStayDate } from '../utils/hotelAppBookingFields';

describe('hotelAppBookingFields', () => {
  it('parses yyyy-MM-dd as Asia/Manila start-of-day (hotel app convention)', () => {
    const d = toStayDate('2026-08-01');
    expect(d.toISOString()).toBe('2026-07-31T16:00:00.000Z');
  });

  it('omits snake_case stay dates by default so hotel inventory is not held', () => {
    const fields = buildHotelAppBookingFields({
      guestName: 'Alice Santos',
      guestEmail: 'alice@example.com',
      checkInDate: '2026-08-01',
      checkOutDate: '2026-08-05',
      paymentMethod: 'gcash',
    });
    expect(fields.check_in_date).toBeUndefined();
    expect(fields.check_out_date).toBeUndefined();
  });

  it('dual-writes snake_case aliases matching hotel online bookings when includeStayDates', () => {
    const now = new Date('2026-07-31T19:30:07.635Z');
    const fields = buildHotelAppBookingFields({
      guestName: 'Alice Santos',
      guestEmail: 'alice@example.com',
      checkInDate: '2026-08-01',
      checkOutDate: '2026-08-05',
      paymentMethod: 'gcash',
      now,
      includeStayDates: true,
    });

    expect(fields.guest_name).toBe('Alice Santos');
    expect(fields.guest_email).toBe('alice@example.com');
    expect(fields.summary_only).toBe(false);
    expect(fields.booking_type).toBe('online');
    expect(fields.booking_source).toBe('website-customer');
    expect(fields.billing_mode).toBe('nightly');
    expect(fields.payment_method).toBe('gcash');
    expect(fields.created_at).toEqual(now);
    expect(fields.updated_at).toEqual(now);
    expect(fields.check_in_date!.toISOString()).toBe('2026-07-31T16:00:00.000Z');
    expect(fields.check_out_date!.toISOString()).toBe('2026-08-04T16:00:00.000Z');
  });
});
