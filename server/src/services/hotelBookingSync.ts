/**
 * Sync hotel-app Online Booking decisions back onto website bookings,
 * then email the guest at guestEmail when a reservation is approved.
 */

import { BookingModel } from '../data/mongoModels';
import {
  queueGuestNotification,
  sendBookingConfirmationNotification,
  sendBookingDeclinedNotification,
} from './notificationService';
import { ensureWebsiteOnlinePaymentLedger } from '../utils/websiteBillingLedger';
import {
  computeOnlinePaymentDue,
  resolveOnlinePaymentModeFromBooking,
} from '../utils/halfPayment';
import { toStayDate } from '../utils/hotelAppBookingFields';
import { coerceSummaryOnly } from '../utils/bookingHotelFields';
import {
  normalizeHotelDecisionStatus,
  type HotelDecisionKind,
} from '../utils/externalReservation';

/** Avoid loading multi-MB Valid ID / payment-proof payloads into confirm/decline paths. */
const BOOKING_SYNC_PROJECTION = '-valid_id_base64 -payment_proof_base64';

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
    const byId = await BookingModel.findById(bookingId).select(BOOKING_SYNC_PROJECTION);
    if (byId) return byId;
  }

  if (bookingReference) {
    const byRef = await BookingModel.findOne({ booking_reference: bookingReference })
      .select(BOOKING_SYNC_PROJECTION);
    if (byRef) return byRef;
  }

  return null;
}

async function persistBookingDecision(
  booking: {
    _id?: unknown;
    status?: string;
    check_in_date?: Date | string | null;
    check_out_date?: Date | string | null;
    summary_only?: boolean | number;
  },
  fields: Record<string, unknown>,
): Promise<void> {
  Object.assign(booking, fields);
  await BookingModel.updateOne({ _id: booking._id }, { $set: fields });
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
  online_payment_mode?: string;
  deposit_percent?: number;
}) {
  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const mode = resolveOnlinePaymentModeFromBooking(booking);
  const fallback = computeOnlinePaymentDue(stayTotal, mode);
  const recorded = Number(booking.amount_paid ?? booking.deposit_amount ?? booking.amountPaid ?? 0);
  const amountDue = recorded > 0
    ? (mode === 'full'
      ? Math.min(recorded, stayTotal) || fallback.amountDue
      : (recorded < stayTotal ? recorded : fallback.amountDue))
    : fallback.amountDue;
  const balance = Math.max(0, stayTotal - amountDue);

  try {
    await ensureWebsiteOnlinePaymentLedger({
      bookingId: String(booking._id),
      hotelId: String(booking.hotel_id ?? ''),
      roomId: String(booking.room_id ?? ''),
      bookingReference: booking.booking_reference,
      nights: Number(booking.nights ?? 1),
      roomRate: Number(booking.roomRate ?? 0),
      stayTotal,
      amountDue,
      balanceDue: balance,
      paymentMethod: String(booking.payment_method ?? booking.paymentMethod ?? ''),
      mode,
      depositPercent: Number(booking.deposit_percent ?? fallback.depositPercent),
    });
  } catch (error) {
    console.error('[HotelSync] Failed to write online-payment ledger after approval:', error);
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
      const datePatch: Record<string, unknown> = {};
      if (attachStayDatesForHotel(booking)) {
        if (booking.check_in_date) datePatch.check_in_date = booking.check_in_date;
        if (booking.check_out_date) datePatch.check_out_date = booking.check_out_date;
        await persistBookingDecision(booking, datePatch);
      }
      await writeLedgerAfterApproval(booking);
      queueGuestNotification('confirmation', () => sendBookingConfirmationNotification(booking));
      return {
        ok: true,
        kind: 'noop',
        bookingId,
        bookingReference,
        previousStatus,
        newStatus: previousStatus,
        emailSent: true,
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

    attachStayDatesForHotel(booking);
    await persistBookingDecision(booking, {
      status: 'reserved',
      check_in_date: booking.check_in_date,
      check_out_date: booking.check_out_date,
      summary_only: coerceSummaryOnly(booking.summary_only),
    });
    await writeLedgerAfterApproval(booking);

    queueGuestNotification('confirmation', () => sendBookingConfirmationNotification(booking));
    return {
      ok: true,
      kind: 'approved',
      bookingId,
      bookingReference,
      previousStatus,
      newStatus: 'reserved',
      emailSent: true,
      message: `Booking reserved; confirmation email queued for ${booking.guestEmail}.`,
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

  const nextStatus = (previousStatus === 'confirmed' || previousStatus === 'reserved' || previousStatus === 'booked')
    ? 'cancelled'
    : 'declined';
  await persistBookingDecision(booking, {
    status: nextStatus,
      summary_only: coerceSummaryOnly(booking.summary_only),
  });

  queueGuestNotification('decline', () => sendBookingDeclinedNotification(booking));

  return {
    ok: true,
    kind: 'rejected',
    bookingId,
    bookingReference,
    previousStatus,
    newStatus: nextStatus,
    emailSent: true,
    message: `Booking marked ${nextStatus}; decline email queued for ${booking.guestEmail}.`,
  };
}
