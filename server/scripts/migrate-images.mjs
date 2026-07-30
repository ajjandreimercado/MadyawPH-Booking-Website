/**
 * migrate-images.mjs
 * Replaces relative image_url paths stored in MongoDB (e.g. /rooms/xxx.jpg)
 * with real Unsplash images so the live website shows actual photos.
 *
 * Run once against production Atlas:
 *   node server/scripts/migrate-images.mjs
 *
 * Requires MONGODB_URI to be set in server/.env or as an environment variable.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI is not set. Add it to server/.env');
  process.exit(1);
}

// ─── Curated Unsplash images for hotel rooms ──────────────────────────────────
const ROOM_IMAGES = [
  'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80', // Deluxe room
  'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&q=80', // Suite
  'https://images.unsplash.com/photo-1566665797739-1674de7a421a?w=800&q=80', // Standard room
  'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80', // Ocean view
  'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=800&q=80', // King bed room
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80', // Beachfront room
  'https://images.unsplash.com/photo-1560347876-aeef00ee58a1?w=800&q=80', // Villa room
  'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80', // Luxury room
];

// ─── Curated Unsplash images for hotel categories ─────────────────────────────
const CATEGORY_IMAGES = [
  'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&q=80', // Beachfront
  'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&q=80', // Resort pool
  'https://images.unsplash.com/photo-1602002418082-a4443e081dd1?w=800&q=80', // Coastal hotel
  'https://images.unsplash.com/photo-1519449556851-5720b33024e7?w=800&q=80', // Ocean suite
  'https://images.unsplash.com/photo-1596178060671-7a80dc8059ea?w=800&q=80', // Tropical villa
  'https://images.unsplash.com/photo-1544124499-58912cbddaad?w=800&q=80', // Garden view
];

// ─── Curated Unsplash images for hotels ──────────────────────────────────────
const HOTEL_IMAGES = [
  'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1200&q=80',
  'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200&q=80',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1200&q=80',
  'https://images.unsplash.com/photo-1568084680786-a84f91d1153c?w=1200&q=80',
  'https://images.unsplash.com/photo-1582610116397-edb318620f90?w=1200&q=80',
];

/** Returns true if the URL is a relative local path (not an http/https URL) */
function isRelativePath(url) {
  return url && !url.startsWith('http://') && !url.startsWith('https://');
}

/** Pick a stable image for a given ID (deterministic, not random) */
function pickImage(id, images) {
  const index = Math.abs(hashCode(String(id))) % images.length;
  return images[index];
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

async function run() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅  Connected to MongoDB Atlas');

    const db = client.db();

    // ── Migrate rooms ──────────────────────────────────────────────────────
    const rooms = db.collection('rooms');
    const roomDocs = await rooms.find({ image_url: { $exists: true } }).toArray();
    let roomsUpdated = 0;

    for (const room of roomDocs) {
      if (isRelativePath(room.image_url)) {
        const newUrl = pickImage(room._id, ROOM_IMAGES);
        await rooms.updateOne({ _id: room._id }, { $set: { image_url: newUrl } });
        roomsUpdated++;
        console.log(`  Room ${room._id}: ${room.image_url} → ${newUrl}`);
      }
    }
    console.log(`\n✅  Rooms updated: ${roomsUpdated} / ${roomDocs.length}`);

    // ── Migrate room categories ────────────────────────────────────────────
    const categories = db.collection('roomcategories');
    const catDocs = await categories.find({ image_url: { $exists: true } }).toArray();
    let catsUpdated = 0;

    for (const cat of catDocs) {
      if (isRelativePath(cat.image_url)) {
        const newUrl = pickImage(cat._id, CATEGORY_IMAGES);
        await categories.updateOne({ _id: cat._id }, { $set: { image_url: newUrl } });
        catsUpdated++;
        console.log(`  Category ${cat.name}: ${cat.image_url} → ${newUrl}`);
      }
    }
    console.log(`\n✅  Room categories updated: ${catsUpdated} / ${catDocs.length}`);

    // ── Migrate hotels ─────────────────────────────────────────────────────
    const hotels = db.collection('hotels');
    const hotelDocs = await hotels.find({ image_url: { $exists: true } }).toArray();
    let hotelsUpdated = 0;

    for (const hotel of hotelDocs) {
      if (isRelativePath(hotel.image_url)) {
        const newUrl = pickImage(hotel._id, HOTEL_IMAGES);
        await hotels.updateOne({ _id: hotel._id }, { $set: { image_url: newUrl } });
        hotelsUpdated++;
        console.log(`  Hotel ${hotel.name}: ${hotel.image_url} → ${newUrl}`);
      }
    }
    console.log(`\n✅  Hotels updated: ${hotelsUpdated} / ${hotelDocs.length}`);

    console.log('\n🎉  Image migration complete! Refresh the live website to see images.');
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
