/**
 * Move inline booking.valid_id_base64 blobs into booking_valid_ids, then unset them
 * from bookings so hotel app list/login queries stop transferring multi-MB documents.
 *
 * Dry-run:  node scripts/migrate-valid-ids-off-bookings.mjs
 * Apply:    CONFIRM_MIGRATE=YES node scripts/migrate-valid-ids-off-bookings.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.env.CONFIRM_MIGRATE === 'YES';

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const bookings = mongoose.connection.collection('bookings');
const validIds = mongoose.connection.collection('booking_valid_ids');

const withBlob = await bookings.countDocuments({
  valid_id_base64: { $exists: true, $nin: [null, ''] },
});
console.log(`Bookings still carrying valid_id_base64: ${withBlob}`);

if (withBlob === 0) {
  console.log('Nothing to migrate.');
  await mongoose.disconnect();
  process.exit(0);
}

const cursor = bookings.find(
  { valid_id_base64: { $exists: true, $nin: [null, ''] } },
  {
    projection: {
      _id: 1,
      booking_reference: 1,
      hotel_id: 1,
      valid_id_filename: 1,
      valid_id_mime: 1,
      valid_id_size: 1,
      valid_id_base64: 1,
      valid_id_uploaded_at: 1,
    },
  },
);

let migrated = 0;
let unsetOnly = 0;

for await (const doc of cursor) {
  const bookingId = String(doc._id);
  const base64 = String(doc.valid_id_base64 ?? '');
  if (!base64) continue;

  if (APPLY) {
    await validIds.updateOne(
      { booking_id: bookingId },
      {
        $set: {
          booking_id: bookingId,
          booking_reference: doc.booking_reference ?? '',
          hotel_id: doc.hotel_id ?? '',
          filename: doc.valid_id_filename || 'valid-id',
          mime: doc.valid_id_mime || 'application/octet-stream',
          size: Number(doc.valid_id_size ?? 0),
          base64,
          uploaded_at: doc.valid_id_uploaded_at || new Date(),
        },
      },
      { upsert: true },
    );

    await bookings.updateOne(
      { _id: doc._id },
      {
        $unset: { valid_id_base64: '' },
        $set: { valid_id_stored: true },
      },
    );
    migrated += 1;
  } else {
    unsetOnly += 1;
    if (unsetOnly <= 10) {
      console.log(
        ` would migrate ${bookingId} (${doc.booking_reference}) size≈${Math.round(base64.length / 1024)}KB base64`,
      );
    }
  }
}

if (!APPLY) {
  console.log(`Dry-run only (${unsetOnly} booking(s)). Re-run with CONFIRM_MIGRATE=YES to apply.`);
} else {
  console.log(`Migrated and unset valid_id_base64 on ${migrated} booking(s).`);
}

await mongoose.disconnect();
