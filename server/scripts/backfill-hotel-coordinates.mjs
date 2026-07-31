/**
 * Non-destructive: geocode hotel location/city into coordinates via Nominatim.
 * Respects 1 req/sec Nominatim policy.
 *
 *   node scripts/backfill-hotel-coordinates.mjs
 *   CONFIRM_BACKFILL=YES node scripts/backfill-hotel-coordinates.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.env.CONFIRM_BACKFILL === 'YES';
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI required');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geocode(query) {
  const params = new URLSearchParams({ q: query, format: 'json', limit: '1' });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'MadyawBookingApp/1.0 (hotel-coord-backfill)' },
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lon = parseFloat(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { latitude: lat, longitude: lon, displayName: data[0].display_name };
}

await mongoose.connect(process.env.MONGODB_URI, process.env.DB_NAME ? { dbName: process.env.DB_NAME } : undefined);
const hotels = mongoose.connection.collection('hotels');
const missing = await hotels.find({
  $or: [
    { coordinates: { $exists: false } },
    { 'coordinates.latitude': { $exists: false } },
    { 'coordinates.longitude': { $exists: false } },
  ],
}).toArray();

let wouldUpdate = 0;
let updated = 0;
let failed = 0;

for (const hotel of missing) {
  const query = [hotel.location, hotel.city, hotel.name].filter(Boolean).join(', ');
  if (!query || query === 'X' || query.length < 3) {
    console.log('skip weak location', hotel.name, query);
    failed += 1;
    continue;
  }

  const result = await geocode(query);
  await sleep(1100); // Nominatim 1 req/sec

  if (!result) {
    // Fallback: city only
    if (hotel.city) {
      const cityResult = await geocode(`${hotel.city}, Philippines`);
      await sleep(1100);
      if (cityResult) {
        wouldUpdate += 1;
        console.log(APPLY ? 'update' : 'dry-run', hotel.name, '→ city fallback', cityResult);
        if (APPLY) {
          await hotels.updateOne(
            { _id: hotel._id },
            { $set: { coordinates: { latitude: cityResult.latitude, longitude: cityResult.longitude } } },
          );
          updated += 1;
        }
        continue;
      }
    }
    console.log('geocode failed', hotel.name, query);
    failed += 1;
    continue;
  }

  wouldUpdate += 1;
  console.log(APPLY ? 'update' : 'dry-run', hotel.name, '→', result.latitude, result.longitude);
  if (APPLY) {
    await hotels.updateOne(
      { _id: hotel._id },
      { $set: { coordinates: { latitude: result.latitude, longitude: result.longitude } } },
    );
    updated += 1;
  }
}

console.log(
  APPLY
    ? `[backfill-coords] Applied. missing=${missing.length} updated=${updated} failed=${failed}`
    : `[backfill-coords] Dry-run. missing=${missing.length} wouldUpdate=${wouldUpdate} failed=${failed}. Set CONFIRM_BACKFILL=YES to apply.`,
);

await mongoose.disconnect();
