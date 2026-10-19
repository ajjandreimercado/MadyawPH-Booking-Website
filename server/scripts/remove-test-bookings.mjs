/**
 * List website bookings so you can pick the test ones, then delete only those references
 * (booking + its Online Bookings row, ID, receipt and billing rows). Deletion is permanent:
 * export a backup in Atlas first.
 *
 * List:    node scripts/remove-test-bookings.mjs
 * Delete:  CONFIRM_CLEANUP=YES node scripts/remove-test-bookings.mjs MDY-ABC123 MDY-DEF456
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const refs = process.argv.slice(2);
const APPLY = process.env.CONFIRM_CLEANUP === 'YES';

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection;
const bookings = db.collection('bookings');

// Website references only: "BK…" rows with source "web" are the hotel app's own bookings (with billing).
const websiteOnly = { source: 'web', booking_reference: /^BR-/ };
const docs = await bookings.find(refs.length
  ? { ...websiteOnly, booking_reference: { $in: refs.filter((r) => r.startsWith('BR-')) } }
  : websiteOnly)
  .project({ booking_reference: 1, status: 1, guestName: 1, guestEmail: 1, checkInDate: 1, totalPrice: 1, created_at: 1, createdAt: 1 })
  .sort({ _id: -1 })
  .toArray();

console.log(`Website bookings${refs.length ? ' matching the given references' : ''}: ${docs.length}`);
for (const d of docs) {
  const created = new Date(d.created_at ?? d.createdAt ?? d._id.getTimestamp?.() ?? 0).toISOString().slice(0, 10);
  console.log(` - ${d.booking_reference}  ${d.status}  created ${created}  stay ${d.checkInDate}  ₱${d.totalPrice}  ${d.guestName} <${d.guestEmail}>`);
}

if (!refs.length || !APPLY) {
  console.log(refs.length
    ? 'Dry-run only. Re-run with CONFIRM_CLEANUP=YES to delete exactly these bookings.'
    : 'Pass the test booking references to delete them (dry-run first, then CONFIRM_CLEANUP=YES).');
  await mongoose.disconnect();
  process.exit(0);
}

const ids = docs.map((d) => String(d._id));
const foundRefs = docs.map((d) => d.booking_reference);
const byBooking = { booking_id: { $in: ids } };
const results = {
  external_reservations: await db.collection('external_reservations')
    .deleteMany({ $or: [byBooking, { external_reference: { $in: foundRefs } }] }),
  booking_valid_ids: await db.collection('booking_valid_ids').deleteMany(byBooking),
  booking_payment_proofs: await db.collection('booking_payment_proofs').deleteMany(byBooking),
  billing_charges: await db.collection('billing_charges').deleteMany(byBooking),
  bookings: await bookings.deleteMany({ _id: { $in: docs.map((d) => d._id) } }),
};
for (const [name, r] of Object.entries(results)) console.log(`Deleted ${r.deletedCount} from ${name}`);
const missing = refs.filter((r) => !foundRefs.includes(r));
if (missing.length) console.log(`Not found (nothing deleted): ${missing.join(', ')}`);
await mongoose.disconnect();
