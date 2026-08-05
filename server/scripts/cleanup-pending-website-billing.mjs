/**
 * Remove premature website billing_charges on still-pending Online Bookings.
 * Those room charges make the hotel app think the room is already held.
 *
 * Dry-run:  node scripts/cleanup-pending-website-billing.mjs
 * Apply:    CONFIRM_CLEANUP=YES node scripts/cleanup-pending-website-billing.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.env.CONFIRM_CLEANUP === 'YES';

await mongoose.connect(process.env.MONGODB_URI);
const bookings = mongoose.connection.collection('bookings');
const charges = mongoose.connection.collection('billing_charges');

const pendingWeb = await bookings.find({
  source: 'web',
  status: { $in: ['pending', 'requested'] },
}).project({ _id: 1, booking_reference: 1 }).toArray();

const ids = pendingWeb.map((b) => String(b._id));
console.log(`Pending website bookings: ${ids.length}`);

if (ids.length === 0) {
  await mongoose.disconnect();
  process.exit(0);
}

const toDelete = await charges.find({
  booking_id: { $in: ids },
  created_by: 'website',
}).toArray();

console.log(`Website billing_charges on pending bookings: ${toDelete.length}`);
for (const row of toDelete.slice(0, 20)) {
  console.log(` - ${row.booking_id} ${row.type} ${row.amount}`);
}

if (!APPLY) {
  console.log('Dry-run only. Re-run with CONFIRM_CLEANUP=YES to delete these charges.');
  await mongoose.disconnect();
  process.exit(0);
}

const result = await charges.deleteMany({
  booking_id: { $in: ids },
  created_by: 'website',
});
await bookings.updateMany(
  { _id: { $in: pendingWeb.map((b) => b._id) } },
  { $set: { hotel_ledger_synced: false } },
);
console.log(`Deleted ${result.deletedCount} billing charge(s). Pending bookings can be approved again.`);
await mongoose.disconnect();
