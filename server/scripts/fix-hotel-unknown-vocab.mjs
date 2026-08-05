/**
 * Align website booking vocab with hotel-app enums so the hotel UI does not show "Unknown".
 *
 * Hotel-native booking status: pending | reserved | booked | completed | cancelled
 * Hotel-native payment_status: unpaid | partial | paid
 *
 * Dry-run:  node scripts/fix-hotel-unknown-vocab.mjs
 * Apply:    CONFIRM_FIX=YES node scripts/fix-hotel-unknown-vocab.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.env.CONFIRM_FIX === 'YES';
await mongoose.connect(process.env.MONGODB_URI);
const bookings = mongoose.connection.collection('bookings');

const requested = await bookings.countDocuments({
  booking_source: 'website-customer',
  status: 'requested',
});
const confirmed = await bookings.countDocuments({
  booking_source: 'website-customer',
  status: 'confirmed',
});
const payPending = await bookings.countDocuments({
  booking_source: 'website-customer',
  payment_status: 'pending',
});

console.log({ requested, confirmed, payPending });

if (!APPLY) {
  console.log('Dry-run only. Re-run with CONFIRM_FIX=YES to apply.');
  await mongoose.disconnect();
  process.exit(0);
}

const r1 = await bookings.updateMany(
  { booking_source: 'website-customer', status: 'requested' },
  {
    $set: { status: 'pending' },
    $unset: { check_in_date: '', check_out_date: '' },
  },
);

const r2 = await bookings.updateMany(
  { booking_source: 'website-customer', status: 'confirmed' },
  { $set: { status: 'reserved' } },
);

const partialPay = await bookings.updateMany(
  {
    booking_source: 'website-customer',
    payment_status: 'pending',
    $or: [
      { amount_paid: { $gt: 0 } },
      { amountPaid: { $gt: 0 } },
      { deposit_amount: { $gt: 0 } },
    ],
  },
  { $set: { payment_status: 'partial' } },
);

const unpaidPay = await bookings.updateMany(
  { booking_source: 'website-customer', payment_status: 'pending' },
  { $set: { payment_status: 'unpaid' } },
);

console.log({
  requestedToPending: r1.modifiedCount,
  confirmedToReserved: r2.modifiedCount,
  pendingPayToPartial: partialPay.modifiedCount,
  pendingPayToUnpaid: unpaidPay.modifiedCount,
});

await mongoose.disconnect();
