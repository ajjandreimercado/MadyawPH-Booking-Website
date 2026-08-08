/**
 * Website online-payment ledger helpers (half or full, per hotel policy).
 *
 * IMPORTANT: Do NOT write billing_charges while the Online Booking is still
 * pending_approval. The hotel app treats a room charge as an inventory hold and
 * will refuse to approve with: "Another stay or hold may overlap those dates"
 * (self-conflict with the website request).
 *
 * Ledger rows are created only after the hotel approves the reservation.
 */

import { BillingChargeModel, BookingModel } from '../data/mongoModels';
import {
  formatMoneyAmount,
  type OnlinePaymentMode,
} from './halfPayment';
import { withRetries } from './withRetries';

export async function ensureWebsiteOnlinePaymentLedger(input: {
  bookingId: string;
  hotelId: string;
  roomId: string;
  bookingReference?: string;
  nights: number;
  roomRate: number;
  stayTotal: number;
  amountDue: number;
  balanceDue: number;
  paymentMethod?: string;
  mode?: OnlinePaymentMode;
  depositPercent?: number;
}): Promise<boolean> {
  const bookingId = String(input.bookingId);
  const hotelId = String(input.hotelId);
  const roomId = String(input.roomId);
  const amountDue = Number(input.amountDue);
  const stayTotal = Number(input.stayTotal);
  const balanceDue = Number(input.balanceDue);
  const nights = Math.max(1, Number(input.nights) || 1);
  const mode: OnlinePaymentMode = input.mode === 'full' || amountDue >= stayTotal ? 'full' : 'half';
  const depositPercent = Number(input.depositPercent ?? (mode === 'full' ? 100 : 50));
  const paymentStatus = mode === 'full' || balanceDue <= 0 ? 'paid' : 'partial';

  if (!bookingId || !hotelId || !roomId || !(stayTotal > 0) || !(amountDue > 0)) {
    return false;
  }

  const now = new Date();
  const paymentLabel = mode === 'full'
    ? 'Payment: Website full stay'
    : 'Partial payment: Website 50% deposit';
  const paymentNote = mode === 'full'
    ? 'Website full stay payment — no balance due at hotel check-out'
    : 'Website half payment deposit — balance due at hotel check-out';

  await withRetries(async () => {
    const existingPartial = await BillingChargeModel.countDocuments({
      booking_id: bookingId,
      type: 'partial_payment',
      created_by: 'website',
    });
    const existingRoom = await BillingChargeModel.countDocuments({
      booking_id: bookingId,
      type: 'room',
      created_by: 'website',
    });
    if (existingPartial > 0 && existingRoom > 0) return;

    const docs: Record<string, unknown>[] = [];
    if (existingRoom === 0) {
      docs.push({
        hotel_id: hotelId,
        booking_id: bookingId,
        room_id: roomId,
        type: 'room',
        label: `Room charge (${nights} night${nights === 1 ? '' : 's'})`,
        amount: formatMoneyAmount(stayTotal),
        quantity: 1,
        is_manual: false,
        created_by: 'website',
        metadata: JSON.stringify({
          channel: 'website',
          billing_mode: 'nightly',
          nights,
          room_rate: input.roomRate,
          booking_reference: input.bookingReference ?? '',
          written_after_hotel_approval: true,
        }),
        created_at: now,
        updated_at: now,
      });
    }
    if (existingPartial === 0) {
      docs.push({
        hotel_id: hotelId,
        booking_id: bookingId,
        room_id: roomId,
        type: 'partial_payment',
        label: paymentLabel,
        amount: formatMoneyAmount(-amountDue),
        quantity: 1,
        is_manual: true,
        created_by: 'website',
        metadata: JSON.stringify({
          channel: 'website',
          payment_method: input.paymentMethod ?? '',
          payment_reference: '',
          note: paymentNote,
          recorded_by: 'website',
          booking_reference: input.bookingReference ?? '',
          online_payment_mode: mode,
          deposit_percent: depositPercent,
          amount_paid: amountDue,
          balance_due: balanceDue,
          stay_total: stayTotal,
          written_after_hotel_approval: true,
        }),
        created_at: now,
        updated_at: now,
      });
    }
    if (docs.length > 0) {
      await BillingChargeModel.insertMany(docs);
    }
  }, { attempts: 3, delayMs: 300, label: 'billing_charges online-payment ledger (post-approval)' });

  await BookingModel.updateOne(
    { _id: bookingId },
    {
      $set: {
        payment_status: paymentStatus,
        amountPaid: amountDue,
        amount_paid: amountDue,
        deposit_amount: amountDue,
        balance_due: balanceDue,
        online_payment_mode: mode,
        deposit_percent: depositPercent,
        total_amount: stayTotal,
        totalPrice: stayTotal,
        serviceFee: 0,
        hotel_ledger_synced: true,
      },
    },
  );

  return true;
}

/** @deprecated Prefer ensureWebsiteOnlinePaymentLedger — kept for older call sites/tests. */
export async function ensureWebsiteHalfPaymentLedger(input: {
  bookingId: string;
  hotelId: string;
  roomId: string;
  bookingReference?: string;
  nights: number;
  roomRate: number;
  stayTotal: number;
  halfPayment: number;
  balanceDue: number;
  paymentMethod?: string;
  mode?: OnlinePaymentMode;
  depositPercent?: number;
}): Promise<boolean> {
  return ensureWebsiteOnlinePaymentLedger({
    ...input,
    amountDue: input.halfPayment,
  });
}
