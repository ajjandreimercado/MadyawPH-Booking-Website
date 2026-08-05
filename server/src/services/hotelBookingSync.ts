/**
 * Sync hotel-app Online Booking decisions back onto website bookings,
 * then email the guest at guestEmail when a reservation is approved.
 */

import { BookingModel } from '../data/mongoModels';
import { sendBookingConfirmationNotification } from './notificationService';
import { ensureWebsiteHalfPaymentLedger } from '../utils/websiteBillingLedger';
import { computeHalfPayment } from '../utils/halfPayment';
import { toStayDate } from '../utils/hotelAppBookingFields';
import {
  normalizeHotelDecisionStatus,
  type HotelDecisionKind,
} from '../utils/externalReservation';

export interface HotelDecisionInput {
  /** Website booking _id when known */
  bookingId?: string;
  /** external_reference / booking_reference */
  bookingReference?: string;
  /** Raw hotel status or event name (approved, reserved, rejected, …) */
  status: string;
  source?: string;
}

export interface HotelDecisionResult {
  ok: boolean;
  kind: HotelDecisionKind | 'noop' | 'not_found' | 'ignored';
  bookingId?: string;
  bookingReference?: string;
  previousStatus?: string;
  newStatus?: string;
  emailSent?: boolean;
  message: string;
}

async function findWebsiteBooking(input: HotelDecisionInput) {
  const bookingId = input.bookingId?.trim();
  const bookingReference = input.bookingReference?.trim();

  if (bookingId) {
    const byId = await BookingModel.findById(bookingId);
    if (byId) return byId;
  }

  if (bookingReference) {
    const byRef = await BookingModel.findOne({ booking_reference: bookingReference });
    if (byRef) return byRef;
  }

  return null;
}

function attachStayDatesForHotel(booking: {
  checkInDate?: string;
  checkOutDate?: string;
  check_in_date?: Date | string | null;
  check_out_date?: Date | string | null;
}) {
  const checkInYmd = String(booking.checkInDate ?? '').slice(0, 10);
  const checkOutYmd = String(booking.checkOutDate ?? '').slice(0, 10);
  let changed = false;
  if (!booking.check_in_date && /^\d{4}-\d{2}-\d{2}$/.test(checkInYmd)) {
    booking.check_in_date = toStayDate(checkInYmd);
    changed = true;
  }
  if (!booking.check_out_date && /^\d{4}-\d{2}-\d{2}$/.test(checkOutYmd)) {
    booking.check_out_date = toStayDate(checkOutYmd);
    changed = true;
  }
  return changed;
}

async function writeLedgerAfterApproval(booking: {
  _id?: unknown;
  hotel_id?: unknown;
  room_id?: unknown;
  booking_reference?: string;
  nights?: number;
  roomRate?: number;
  totalPrice?: number;
  total_amount?: number;
  amountPaid?: number;
  amount_paid?: number;
  deposit_amount?: number;
  balance_due?: number;
  paymentMethod?: string;
  payment_method?: string;
}) {
  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const recordedHalf = Number(booking.amount_paid ?? booking.deposit_amount ?? booking.amountPaid ?? 0);
  const { halfPayment, balanceDue } = computeHalfPayment(stayTotal);
  const half = recordedHalf > 0 && recordedHalf < stayTotal ? recordedHalf : halfPayment;
  const balance = Math.max(0, stayTotal - half);

  try {
    await ensureWebsiteHalfPaymentLedger({
      bookingId: String(booking._id),
      hotelId: String(booking.hotel_id ?? ''),
      roomId: String(booking.room_id ?? ''),
      bookingReference: booking.booking_reference,
      nights: Number(booking.nights ?? 1),
      roomRate: Number(booking.roomRate ?? 0),
      stayTotal,
      halfPayment: half,
      balanceDue: balance,
      paymentMethod: String(booking.payment_method ?? booking.paymentMethod ?? ''),
    });
  } catch (error) {
    console.error('[HotelSync] Failed to write half-payment ledger after approval:', error);
  }
}

/**
 * Apply a hotel Online Bookings decision to the matching website booking.
 * Approval → status confirmed + confirmation email to guestEmail + billing ledger.
 * Rejection → status cancelled (no email).
 */
export async function applyHotelBookingDecision(input: HotelDecisionInput): Promise<HotelDecisionResult> {
  const kind = normalizeHotelDecisionStatus(input.status);
  if (!kind) {
    return {
      ok: true,
      kind: 'ignored',
      message: `Status "${input.status}" does not map to an approval or rejection — ignored.`,
    };
  }

  const booking = await findWebsiteBooking(input);
  if (!booking) {
    return {
      ok: false,
      kind: 'not_found',
      bookingId: input.bookingId,
      bookingReference: input.bookingReference,
      message: 'No matching website booking found for this hotel event.',
    };
  }

  const bookingId = String(booking._id);
  const bookingReference = String(booking.booking_reference ?? '');
  const previousStatus = String(booking.status ?? '');

  if (kind === 'approved') {
    // Hotel may already set reserved/booked — treat those as approved too.
    const alreadyActive = ['confirmed', 'reserved', 'booked'].includes(previousStatus);
    if (alreadyActive) {
      if (attachStayDatesForHotel(booking)) {
        await booking.save();
      }
      await writeLedgerAfterApproval(booking);
      const emailSent = await sendBookingConfirmationNotification(booking);
      return {
        ok: true,
        kind: 'noop',
        bookingId,
        bookingReference,
        previousStatus,
        newStatus: previousStatus,
        emailSent,
        message: 'Booking was already approved; confirmation email/ledger checked.',
      };
    }

    if (['cancelled', 'declined'].includes(previousStatus)) {
      return {
        ok: false,
        kind: 'ignored',
        bookingId,
        bookingReference,
        previousStatus,
        message: `Cannot confirm a booking with status "${previousStatus}".`,
      };
    }

    booking.status = 'confirmed';
    attachStayDatesForHotel(booking);
    if (typeof booking.summary_only !== 'boolean') {
      booking.summary_only = false;
    }
    await booking.save();
    await writeLedgerAfterApproval(booking);

    const emailSent = await sendBookingConfirmationNotification(booking);
    return {
      ok: true,
      kind: 'approved',
      bookingId,
      bookingReference,
      previousStatus,
      newStatus: 'confirmed',
      emailSent,
      message: emailSent
        ? `Booking confirmed and confirmation email sent to ${booking.guestEmail}.`
        : `Booking confirmed; confirmation email was not delivered (check RESEND_API_KEY / logs).`,
    };
  }

  // rejected
  if (['cancelled', 'declined'].includes(previousStatus)) {
    return {
      ok: true,
      kind: 'noop',
      bookingId,
      bookingReference,
      previousStatus,
      newStatus: previousStatus,
      message: 'Booking was already cancelled/declined.',
    };
  }

  if (previousStatus === 'confirmed' || previousStatus === 'reserved' || previousStatus === 'booked') {
    booking.status = 'cancelled';
  } else {
    booking.status = 'declined';
  }
  if (typeof booking.summary_only !== 'boolean') {
    booking.summary_only = false;
  }
  await booking.save();

  return {
    ok: true,
    kind: 'rejected',
    bookingId,
    bookingReference,
    previousStatus,
    newStatus: String(booking.status),
    message: `Booking marked ${booking.status} after hotel rejection.`,
  };
}
