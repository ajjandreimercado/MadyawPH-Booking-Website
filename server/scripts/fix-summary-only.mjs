/**
 * Heal hotel-app Reports error:
 * "The summary only field must be true or false."
 *
 * Writes integer 0|1 (not BSON false). Laravel's boolean rule accepts 0/1;
 * some PHP Mongo layers turn BSON false into "" which then fails validation.
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

const needsHeal = { summary_only: { $nin: [0, 1] } };

async function main() {
  await mongoose.connect(MONGODB_URI, DB_NAME ? { dbName: DB_NAME } : undefined);
  const bookings = mongoose.connection.collection('bookings');

  const toTrue = await bookings.countDocuments({ summary_only: { $in: [true, '1', 'true'] } });
  const toFalse = await bookings.countDocuments(needsHeal);
  console.log(
    APPLY
      ? `[fix-summary-only] Healing ${toFalse} booking(s) to 0|1 (${toTrue} currently truthy)…`
      : `[fix-summary-only] Dry-run: ${toFalse} booking(s) would be rewritten as integer 0|1. Set CONFIRM_FIX=YES to apply.`,
  );

  if (APPLY && toFalse > 0) {
    const setTrue = await bookings.updateMany(
      { summary_only: { $in: [true, '1', 'true'] } },
      { $set: { summary_only: 1 } },
    );
    const setFalse = await bookings.updateMany(
      { summary_only: { $nin: [0, 1] } },
      { $set: { summary_only: 0 } },
    );
    console.log(`[fix-summary-only] Set 1: ${setTrue.modifiedCount}. Set 0: ${setFalse.modifiedCount}.`);
  }

  const types = await bookings.aggregate([
    { $group: { _id: { $type: '$summary_only' }, n: { $sum: 1 } } },
  ]).toArray();
  console.log('[fix-summary-only] BSON types now:', JSON.stringify(types));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
