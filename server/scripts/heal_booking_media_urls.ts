/**
 * Backfill guest_id_url / payment_proof_url token links on website bookings.
 * Usage: npx tsx scripts/heal_booking_media_urls.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { healBookingMediaUrls } from '../src/utils/healBookingMediaUrls';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!, {
    dbName: process.env.MONGODB_DB_NAME || 'hotel_hms',
  });
  const result = await healBookingMediaUrls();
  console.log(`Done. Healed ${result.healed} booking(s).`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
