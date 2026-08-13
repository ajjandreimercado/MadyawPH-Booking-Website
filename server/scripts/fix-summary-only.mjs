/**
 * Normalize website-written booking documents to the hotel app's own shape.
 *
 *   summary_only -> strict boolean (never null / "" / missing / int)
 *   room_id      -> string form of the room ObjectId (hotel bookings use strings,
 *                   so a raw ObjectId makes hotel room lookups miss website bookings)
 *
 * Usage:
 *   node scripts/fix-summary-only.mjs           # dry-run
 *   CONFIRM_FIX=YES node scripts/fix-summary-only.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const APPLY = process.env.CONFIRM_FIX === 'YES';

if (!MONGODB_URI) throw new Error('MONGODB_URI is required.');

async function main() {
  await mongoose.connect(MONGODB_URI, DB_NAME ? { dbName: DB_NAME } : undefined);
  const bookings = mongoose.connection.collection('bookings');

  const truthy = { summary_only: { $in: [1, '1', 'true'] } };
  const notBoolean = { summary_only: { $nin: [true, false] } };
  const objectIdRoom = { room_id: { $type: 'objectId' } };

  console.log('[normalize] summary_only truthy-but-not-true :', await bookings.countDocuments(truthy));
  console.log('[normalize] summary_only not a boolean       :', await bookings.countDocuments(notBoolean));
  console.log('[normalize] room_id stored as ObjectId       :', await bookings.countDocuments(objectIdRoom));

  if (!APPLY) {
    console.log('[normalize] Dry-run only. Set CONFIRM_FIX=YES to apply.');
  } else {
    const setTrue = await bookings.updateMany(truthy, { $set: { summary_only: true } });
    const setFalse = await bookings.updateMany(notBoolean, { $set: { summary_only: false } });
    console.log(`[normalize] summary_only -> true: ${setTrue.modifiedCount}, false: ${setFalse.modifiedCount}`);

    let rooms = 0;
    const cursor = bookings.find(objectIdRoom).project({ room_id: 1 });
    for await (const doc of cursor) {
      await bookings.updateOne(
        { _id: doc._id },
        { $set: { room_id: String(doc.room_id) } },
      );
      rooms += 1;
    }
    console.log(`[normalize] room_id -> string: ${rooms}`);
  }

  const summaryTypes = await bookings.aggregate([
    { $group: { _id: { $type: '$summary_only' }, n: { $sum: 1 } } },
  ]).toArray();
  const roomTypes = await bookings.aggregate([
    { $group: { _id: { $type: '$room_id' }, n: { $sum: 1 } } },
  ]).toArray();
  console.log('[normalize] summary_only types:', JSON.stringify(summaryTypes));
  console.log('[normalize] room_id types    :', JSON.stringify(roomTypes));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
