/**
 * One-off heal for hotel-app Reports error:
 * "The summary only field must be true or false."
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

const filter = {
  $or: [
    { summary_only: { $exists: false } },
    { summary_only: { $nin: [true, false] } },
  ],
};

async function main() {
  await mongoose.connect(MONGODB_URI, DB_NAME ? { dbName: DB_NAME } : undefined);
  const bookings = mongoose.connection.collection('bookings');

  const count = await bookings.countDocuments(filter);
  console.log(
    APPLY
      ? `[fix-summary-only] Found ${count} booking(s) with invalid summary_only. Applying…`
      : `[fix-summary-only] Dry-run: ${count} booking(s) would be set to summary_only=false. Set CONFIRM_FIX=YES to apply.`,
  );

  if (APPLY && count > 0) {
    const result = await bookings.updateMany(filter, { $set: { summary_only: false } });
    console.log(`[fix-summary-only] Updated ${result.modifiedCount} booking(s).`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
