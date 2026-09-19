/**
 * Push guest payment-proof screenshots into every collection the hotel app reads,
 * and keep deposit unverified until hotel staff confirms in MADYAWPH.
 */

import { BookingModel, BookingPaymentProofModel, BookingValidIdModel, ExternalReservationModel } from '../data/mongoModels';
import { withRetries } from './withRetries';
import { ensureWebsiteOnlinePaymentLedger } from './websiteBillingLedger';
import {
  computeOnlinePaymentDue,
  resolveOnlinePaymentModeFromBooking,
} from './halfPayment';

export interface PaymentProofHotelSyncInput {
  bookingId: string;
  bookingReference: string;
  hotelId: string;
  roomId?: string;
  filename: string;
  mime: string;
  size: number;
  base64: string;
  transactionRef: string;
  amountClaimed: number;
  expectedDeposit: number;
  stayTotal: number;
  nights?: number;
  roomRate?: number;
  paymentMethod?: string;
  uploadedAt?: Date;
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/**
 * Store the screenshot where the hotel app looks, and flag Online Bookings that
 * proof is awaiting staff verification (deposit is NOT confirmed yet).
 */
export async function syncPaymentProofToHotelApp(input: PaymentProofHotelSyncInput): Promise<void> {
  const now = input.uploadedAt ?? new Date();
  const bookingId = String(input.bookingId);
  const hotelId = String(input.hotelId);
  const filename = input.filename.slice(0, 200);
  const mode = resolveOnlinePaymentModeFromBooking({
    online_payment_mode: undefined,
    totalPrice: input.stayTotal,
    amount_paid: 0,
    deposit_amount: input.expectedDeposit,
  });
  const due = computeOnlinePaymentDue(input.stayTotal, mode);
  const amountDue = Number(input.expectedDeposit || due.amountDue);

  await withRetries(async () => {
    await BookingPaymentProofModel.findOneAndUpdate(
      { booking_id: bookingId },
      {
        $set: {
          booking_id: bookingId,
          booking_reference: input.bookingReference,
          hotel_id: hotelId,
          filename,
          mime: input.mime,
          size: input.size,
          base64: input.base64,
          uploaded_at: now,
          type: 'payment_proof',
          kind: 'payment_proof',
          payment_proof_base64: input.base64,
          payment_proof_mime: input.mime,
          payment_proof_filename: filename,
          payment_transaction_ref: input.transactionRef,
          payment_proof_amount_claimed: input.amountClaimed,
          expected_deposit_amount: amountDue,
          // Hotel staff must confirm in MADYAWPH before deposit is accepted.
          payment_proof_verified: false,
          payment_proof_verified_at: null,
        },
      },
      { upsert: true, new: true },
    );

    await BookingValidIdModel.findOneAndUpdate(
      { booking_id: bookingId },
      {
        $set: {
          booking_id: bookingId,
          booking_reference: input.bookingReference,
          hotel_id: hotelId,
          payment_proof_filename: filename,
          payment_proof_mime: input.mime,
          payment_proof_size: input.size,
          payment_proof_base64: input.base64,
          payment_proof_uploaded_at: now,
          payment_proof_stored: true,
          payment_transaction_ref: input.transactionRef,
          payment_proof_amount_claimed: input.amountClaimed,
          payment_proof_verified: false,
          payment_proof_verified_at: null,
        },
      },
      { upsert: true, new: true },
    );
  }, { attempts: 3, delayMs: 200, label: 'hotel payment proof image store' });

  // Online Bookings row — hotel UI reads payment_proof_* from metadata.
  const externalRows = await ExternalReservationModel.find({
    $or: [
      { booking_id: bookingId },
      { external_reference: input.bookingReference },
    ],
  }).lean();

  for (const row of externalRows) {
    const meta = parseMetadata(row.metadata);
    const nextMeta = {
      ...meta,
      payment_proof_uploaded: true,
      payment_proof_filename: filename,
      payment_proof_mime: input.mime,
      payment_proof_collection: 'booking_payment_proofs',
      payment_proof_size: input.size,
      payment_transaction_ref: input.transactionRef,
      payment_proof_amount_claimed: input.amountClaimed,
      payment_proof_expected_amount: amountDue,
      payment_proof_verified: false,
      payment_proof_verified_at: null,
      // Still unpaid until hotel verifies the screenshot.
      payment_status: 'unpaid',
      amount_paid: 0,
      amount_due: amountDue,
      balance_due: Math.max(0, input.stayTotal),
      note: 'Website guest uploaded deposit proof — awaiting hotel verification',
      deposit_awaiting_verification: true,
    };

    const rowId = String(row._id);
    await ExternalReservationModel.updateOne(
      { _id: rowId } as never,
      {
        $set: {
          metadata: JSON.stringify(nextMeta),
          updated_at: now,
        },
      },
    );
  }
}

/**
 * When hotel staff verifies the screenshot in MADYAWPH, record the deposit on
 * the booking + billing ledger.
 */
export async function finalizeDepositAfterHotelVerification(bookingId: string): Promise<boolean> {
  const booking = await BookingModel.findById(bookingId);
  if (!booking) return false;
  if (!booking.payment_proof_stored && !booking.payment_proof_filename) return false;
  if (!booking.payment_proof_verified) return false;

  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const mode = resolveOnlinePaymentModeFromBooking(booking);
  const due = computeOnlinePaymentDue(stayTotal, mode);
  const amountDue = Number(
    booking.payment_proof_amount_claimed
    ?? booking.deposit_amount
    ?? due.amountDue,
  );
  if (!(amountDue > 0) || !(stayTotal > 0)) return false;

  const balanceDue = Math.max(0, stayTotal - amountDue);
  const paymentStatus = balanceDue <= 0 ? 'paid' : 'partial';
  const now = new Date();

  await BookingModel.updateOne(
    { _id: booking._id },
    {
      $set: {
        amountPaid: amountDue,
        amount_paid: amountDue,
        deposit_amount: amountDue,
        balance_due: balanceDue,
        payment_status: paymentStatus,
        payment_proof_verified: true,
        payment_proof_verified_at: booking.payment_proof_verified_at ?? now,
      },
    },
  );

  await BookingPaymentProofModel.updateOne(
    { booking_id: String(booking._id) },
    { $set: { payment_proof_verified: true, payment_proof_verified_at: now } },
  ).catch(() => undefined);

  await ensureWebsiteOnlinePaymentLedger({
    bookingId: String(booking._id),
    hotelId: String(booking.hotel_id ?? ''),
    roomId: String(booking.room_id ?? ''),
    bookingReference: String(booking.booking_reference ?? ''),
    nights: Number(booking.nights ?? 1),
    roomRate: Number(booking.roomRate ?? 0),
    stayTotal,
    amountDue,
    balanceDue,
    amountPaid: amountDue,
    paymentMethod: String(booking.paymentMethod ?? booking.payment_method ?? ''),
    mode,
    depositPercent: Number(booking.deposit_percent ?? due.depositPercent),
  });

  const externalRows = await ExternalReservationModel.find({
    $or: [
      { booking_id: String(booking._id) },
      { external_reference: booking.booking_reference },
    ],
  }).lean();

  for (const row of externalRows) {
    const meta = parseMetadata(row.metadata);
    await ExternalReservationModel.updateOne(
      { _id: String(row._id) } as never,
      {
        $set: {
          metadata: JSON.stringify({
            ...meta,
            payment_proof_verified: true,
            payment_proof_verified_at: now.toISOString(),
            payment_status: paymentStatus,
            amount_paid: amountDue,
            balance_due: balanceDue,
            deposit_awaiting_verification: false,
            note: 'Website deposit verified by hotel',
          }),
          updated_at: now,
        },
      },
    );
  }

  return true;
}
