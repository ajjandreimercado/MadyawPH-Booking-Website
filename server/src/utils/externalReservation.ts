/**
 * Hotel app "Online Bookings" reads the `external_reservations` collection
 * (typically status = pending_approval), not website camelCase booking docs alone.
 */

export const ONLINE_BOOKING_EXTERNAL_SOURCE = 'app-customer';
export const ONLINE_BOOKING_PENDING_STATUS = 'pending_approval';

export function buildExternalReservationDoc(input: {
  hotelId: string;
  bookingId: string;
  bookingReference: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  checkInDate: Date;
  checkOutDate: Date;
  roomId: string;
  paymentMethod: string;
  totalAmount: number;
  halfPayment?: number;
  balanceDue?: number;
  nights: number;
  adults: number;
  children?: number;
  now?: Date;
  validIdUploaded?: boolean;
  validIdFilename?: string;
}) {
  const now = input.now ?? new Date();
  const metadata = {
    // Hotel Online Bookings queue filters external_reservations (often by app-customer + pending_approval).
    // Keep website identity in metadata / booking.booking_source.
    channel: 'website',
    booking_source: 'website-customer',
    booking_reference: input.bookingReference,
    payment_method: input.paymentMethod,
    estimated_total: input.totalAmount,
    amount_paid: input.halfPayment ?? 0,
    balance_due: input.balanceDue ?? input.totalAmount,
    payment_status: 'partial',
    deposit_percent: 50,
    note: 'Website half deposit — remaining balance due at hotel check-out',
    valid_id_uploaded: Boolean(input.validIdUploaded),
    valid_id_filename: input.validIdFilename ?? '',
    billing_mode: 'nightly',
    nights: input.nights,
    rooms: 1,
    adults: input.adults,
    children: input.children ?? 0,
  };

  return {
    hotel_id: input.hotelId,
    source: ONLINE_BOOKING_EXTERNAL_SOURCE,
    external_reference: input.bookingReference,
    guest_name: input.guestName,
    guest_email: input.guestEmail,
    guest_phone: input.guestPhone,
    check_in_date: input.checkInDate,
    check_out_date: input.checkOutDate,
    assigned_room_id: input.roomId,
    booking_id: input.bookingId,
    status: ONLINE_BOOKING_PENDING_STATUS,
    // Match hotel/PHP documents that store metadata as a JSON string.
    metadata: JSON.stringify(metadata),
    created_at: now,
    updated_at: now,
  };
}
