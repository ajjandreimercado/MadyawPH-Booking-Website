/**
 * Website half-payment ledger helpers.
 *
 * IMPORTANT: Do NOT write billing_charges while the Online Booking is still
 * pending_approval. The hotel app treats a room charge as an inventory hold and
 * will refuse to approve with: "Another stay or hold may overlap those dates"
 * (self-conflict with the website request).
 *
 * Ledger rows are created only after the hotel approves the reservation.
 */

import { BillingChargeModel, BookingModel } from '../data/mongoModels';
import { formatMoneyAmount } from './halfPayment';
import { withRetries } from './withRetries';

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
}): Promise<boolean> {
  const bookingId = String(input.bookingId);
  const hotelId = String(input.hotelId);
  const roomId = String(input.roomId);
  const halfPayment = Number(input.halfPayment);
  const stayTotal = Number(input.stayTotal);
  const balanceDue = Number(input.balanceDue);
  const nights = Math.max(1, Number(input.nights) || 1);

  if (!bookingId || !hotelId || !roomId || !(stayTotal > 0) || !(halfPayment > 0)) {
    return false;
  }

  const now = new Date();

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
        label: 'Partial payment: Website 50% deposit',
        amount: formatMoneyAmount(-halfPayment),
        quantity: 1,
        is_manual: true,
        created_by: 'website',
        metadata: JSON.stringify({
          channel: 'website',
          payment_method: input.paymentMethod ?? '',
          payment_reference: '',
          note: 'Website half payment deposit — balance due at hotel check-out',
          recorded_by: 'website',
          booking_reference: input.bookingReference ?? '',
          deposit_percent: 50,
          amount_paid: halfPayment,
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
  }, { attempts: 3, delayMs: 300, label: 'billing_charges half-payment ledger (post-approval)' });

  await BookingModel.updateOne(
    { _id: bookingId },
    {
      $set: {
        payment_status: 'partial',
        amountPaid: halfPayment,
        amount_paid: halfPayment,
        deposit_amount: halfPayment,
        balance_due: balanceDue,
        total_amount: stayTotal,
        totalPrice: stayTotal,
        serviceFee: 0,
        hotel_ledger_synced: true,
      },
    },
  );

  return true;
}
