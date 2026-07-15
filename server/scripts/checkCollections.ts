import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load server/.env so MONGODB_URI is available.
// NEVER hardcode credentials (username:password) in script files.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('[checkCollections] ERROR: MONGODB_URI is not set in server/.env');
  process.exit(1);
}

async function main() {
  // Mask credentials in the log so they never appear in CI output or terminal history.
  const safeUri = MONGODB_URI!.replace(/:\/\/[^@]*@/, '://***:***@');
  console.log(`[checkCollections] Connecting to: ${safeUri}`);

  await mongoose.connect(MONGODB_URI!);
  const db = mongoose.connection.db!;

  // Check the underscore-named collections
  const roomCatsUnderscore = await db.collection('room_categories').find({}).toArray();
  console.log(`=== room_categories (with underscore): ${roomCatsUnderscore.length} docs ===`);
  roomCatsUnderscore.slice(0, 5).forEach(c =>
    console.log(`  _id: "${c._id}" | hotel_id: "${c.hotel_id}" (${c.hotel_id?.constructor?.name ?? typeof c.hotel_id}) | name: ${c.name}`)
  );

  const roomCatsNoUnderscore = await db.collection('roomcategories').find({}).toArray();
  console.log(`\n=== roomcategories (no underscore): ${roomCatsNoUnderscore.length} docs ===`);

  const roomTransfersUnderscore = await db.collection('room_transfers').find({}).limit(3).toArray();
  console.log(`\n=== room_transfers (with underscore): ${roomTransfersUnderscore.length} docs ===`);

  // Check rooms collection more carefully — show full doc
  const room = await db.collection('rooms').findOne({});
  console.log('\n=== Full sample room document ===');
  console.log(JSON.stringify(room, null, 2));

  // Check hotel_id type stored in room_categories
  const firstCat = roomCatsUnderscore[0];
  if (firstCat) {
    console.log('\n=== room_categories hotel_id analysis ===');
    console.log(`  hotel_id value: ${firstCat.hotel_id}`);
    console.log(`  hotel_id type: ${typeof firstCat.hotel_id}`);
    console.log(`  hotel_id constructor: ${firstCat.hotel_id?.constructor?.name}`);

    const hotelId = firstCat.hotel_id;
    const matched = await db.collection('rooms').find({ hotel_id: hotelId }).toArray();
    console.log(`  Rooms matching that hotel_id: ${matched.length}`);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
