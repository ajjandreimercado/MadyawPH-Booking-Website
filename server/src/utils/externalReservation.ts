/**
 * Hotel app "Online Bookings" reads the `external_reservations` collection
 * (typically status = pending_approval), not website camelCase booking docs alone.
 */

export const ONLINE_BOOKING_EXTERNAL_SOURCE = 'app-customer';
export const ONLINE_BOOKING_PENDING_STATUS = 'pending_approval';

/** Statuses the hotel app writes when a website request is accepted for check-in. */
export const HOTEL_APPROVED_STATUSES = new Set([
  'approved',
  'reserved',
  'confirmed',
  'accepted',
  'booked',
  'checked_in',
  'checked-in',
]);

/** Statuses the hotel app writes when a website request is turned down. */
export const HOTEL_REJECTED_STATUSES = new Set([
  'rejected',
  'declined',
  'cancelled',
  'canceled',
]);

export type HotelDecisionKind = 'approved' | 'rejected';

export function normalizeHotelDecisionStatus(raw: string | undefined | null): HotelDecisionKind | null {
  const status = String(raw ?? '').trim().toLowerCase();
  if (!status) return null;

  // Webhook event names
  if (
    status === 'reservation.approved'
    || status === 'reservation.confirmed'
    || status === 'reservation.reserved'
    || status.endsWith('.approved')
    || status.endsWith('.confirmed')
  ) {
    return 'approved';
  }
  if (
    status === 'reservation.rejected'
    || status === 'reservation.declined'
    || status === 'reservation.cancelled'
    || status.endsWith('.rejected')
    || status.endsWith('.declined')
    || status.endsWith('.cancelled')
  ) {
    return 'rejected';
  }

  if (HOTEL_APPROVED_STATUSES.has(status)) return 'approved';
  if (HOTEL_REJECTED_STATUSES.has(status)) return 'rejected';
  return null;
}

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
  amountDue?: number;
  /** @deprecated Use amountDue */
  halfPayment?: number;
  balanceDue?: number;
  depositPercent?: number;
  onlinePaymentMode?: 'half' | 'full';
  nights: number;
  adults: number;
  children?: number;
  now?: Date;
  validIdUploaded?: boolean;
  validIdFilename?: string;
}) {
  const now = input.now ?? new Date();
  const amountDue = Number(input.amountDue ?? input.halfPayment ?? 0);
  const balanceDue = Number(
    input.balanceDue
    ?? Math.max(0, Number(input.totalAmount) - amountDue),
  );
  const mode = input.onlinePaymentMode
    ?? (amountDue > 0 && amountDue >= Number(input.totalAmount) ? 'full' : 'half');
  const depositPercent = Number(input.depositPercent ?? (mode === 'full' ? 100 : 50));
  const paymentStatus = mode === 'full' || balanceDue <= 0 ? 'paid' : 'partial';
  const note = mode === 'full'
    ? 'Website full stay payment — no remaining balance at hotel check-out'
    : 'Website half deposit — remaining balance due at hotel check-out';

  const metadata = {
    // Hotel Online Bookings queue filters external_reservations (often by app-customer + pending_approval).
    // Keep website identity in metadata / booking.booking_source.
    channel: 'website',
    booking_source: 'website-customer',
    booking_reference: input.bookingReference,
    payment_method: input.paymentMethod,
    estimated_total: input.totalAmount,
    amount_paid: amountDue,
    balance_due: balanceDue,
    payment_status: paymentStatus,
    online_payment_mode: mode,
    deposit_percent: depositPercent,
    note,
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
