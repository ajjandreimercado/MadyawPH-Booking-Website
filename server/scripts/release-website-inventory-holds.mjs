/**
 * Clear hotel inventory holds caused by website Online Booking requests.
 * Unsets check_in_date/check_out_date and moves status pending → requested.
 *
 * Dry-run:  node scripts/release-website-inventory-holds.mjs
 * Apply:    CONFIRM_CLEANUP=YES node scripts/release-website-inventory-holds.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.env.CONFIRM_CLEANUP === 'YES';

await mongoose.connect(process.env.MONGODB_URI);
const bookings = mongoose.connection.collection('bookings');

const filter = {
  source: 'web',
  status: { $in: ['pending', 'requested'] },
};

const docs = await bookings.find(filter).project({
  booking_reference: 1,
  status: 1,
  check_in_date: 1,
  check_out_date: 1,
  room_id: 1,
}).toArray();

console.log(`Website request bookings: ${docs.length}`);
for (const d of docs.slice(0, 15)) {
  console.log(` - ${d.booking_reference} status=${d.status} hasHotelDates=${Boolean(d.check_in_date)}`);
}

if (!APPLY) {
  console.log('Dry-run only. Re-run with CONFIRM_CLEANUP=YES to release inventory holds.');
  await mongoose.disconnect();
  process.exit(0);
}

const result = await bookings.updateMany(filter, {
  $set: { status: 'requested' },
  $unset: { check_in_date: '', check_out_date: '' },
});

console.log(`Updated ${result.modifiedCount} booking(s). Hotel approve should no longer self-block.`);
await mongoose.disconnect();
