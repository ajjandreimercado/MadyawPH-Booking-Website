import { buildExternalReservationDoc, ONLINE_BOOKING_EXTERNAL_SOURCE, ONLINE_BOOKING_PENDING_STATUS } from '../utils/externalReservation';

describe('externalReservation', () => {
  it('builds an Online Bookings queue row matching hotel external_reservations shape', () => {
    const now = new Date('2026-07-31T19:30:07.635Z');
    const doc = buildExternalReservationDoc({
      hotelId: 'hotel-1',
      bookingId: 'booking-1',
      bookingReference: 'BR-123',
      guestName: 'Alice',
      guestEmail: 'alice@example.com',
      guestPhone: '09171234567',
      checkInDate: new Date('2026-07-31T16:00:00.000Z'),
      checkOutDate: new Date('2026-08-01T16:00:00.000Z'),
      roomId: 'room-704',
      paymentMethod: 'gcash',
      totalAmount: 1120,
      nights: 1,
      adults: 2,
      children: 0,
      now,
    });

    expect(doc.source).toBe(ONLINE_BOOKING_EXTERNAL_SOURCE);
    expect(doc.status).toBe(ONLINE_BOOKING_PENDING_STATUS);
    expect(doc.external_reference).toBe('BR-123');
    expect(doc.booking_id).toBe('booking-1');
    expect(doc.assigned_room_id).toBe('room-704');
    expect(doc.guest_name).toBe('Alice');
    expect(typeof doc.metadata).toBe('string');
    const meta = JSON.parse(doc.metadata as string);
    expect(meta.channel).toBe('website');
    expect(meta.booking_source).toBe('website-customer');
    expect(meta.estimated_total).toBe(1120);
  });
});
