import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * DESTRUCTIVE demo cleanup. Refuses to run unless CONFIRM_DESTRUCTIVE_CLEANUP=YES.
 * Do NOT run against shared production data used by the hotel management app.
 */
if (process.env.CONFIRM_DESTRUCTIVE_CLEANUP !== 'YES') {
  console.error(
    '[remove-demo-data] Aborted. This script deletes matching MongoDB documents.\n' +
      'Set CONFIRM_DESTRUCTIVE_CLEANUP=YES only if you intentionally want that cleanup.',
  );
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is required.');
}

if (!DB_NAME) {
  throw new Error('DB_NAME is required.');
}

const targetHotelName = 'Madyaw Boracay Resort';
const targetHotelId = '6a1a4cb9edb047c7dc5cc977';
const targetHotelObjectId = new mongoose.Types.ObjectId(targetHotelId);
const demoUserEmailPattern = /@madyaw\.com$/i;
const demoTestUserEmailPattern = /^ai_test_/i;
const demoUserNamePattern = /^guest traveler$/i;
const demoTestUserNamePattern = /^ai test$/i;
const demoReviewPropertyPattern = /^seed-/i;

function toPlain(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, current) => {
      if (current && typeof current === 'object' && current._bsontype === 'ObjectId') {
        return String(current);
      }

      return current;
    })
  );
}

function getName(document) {
  return document.name ?? document.display_name ?? document.category_name ?? document.propertyName ?? document.title ?? document.booking_reference ?? document._id;
}

function logDocuments(label, documents) {
  console.log(`\n${label} (${documents.length})`);

  for (const document of documents) {
    console.log(
      JSON.stringify(
        {
          collection: label,
          _id: String(document._id),
          name: getName(document),
        },
        null,
        2,
      )
    );
  }
}

function buildHotelMatchFilter() {
  return {
    $or: [
      { name: { $regex: new RegExp(`^${targetHotelName}$`, 'i') } },
      { _id: targetHotelObjectId },
      { _id: targetHotelId },
    ],
  };
}

function buildRelatedFilter() {
  return {
    $or: [
      { hotelId: targetHotelId },
      { hotel_id: targetHotelObjectId },
      { hotel_id: targetHotelId },
      { hotelId: targetHotelObjectId },
      { hotel_name: { $regex: new RegExp(`^${targetHotelName}$`, 'i') } },
    ],
  };
}

function buildDemoReviewFilter() {
  return {
    $or: [
      buildRelatedFilter(),
      { propertyId: { $regex: demoReviewPropertyPattern } },
    ],
  };
}

function buildDemoUserFilter() {
  return {
    $or: [
      { email: { $regex: demoUserEmailPattern } },
      { email: { $regex: demoTestUserEmailPattern } },
      { name: { $regex: demoUserNamePattern } },
      { name: { $regex: demoTestUserNamePattern } },
    ],
  };
}

async function main() {
  console.log(`Connecting to MongoDB database: ${DB_NAME}`);
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });

  const db = mongoose.connection.db;

  const hotels = db.collection('hotels');
  const rooms = db.collection('rooms');
  const roomCategories = db.collection('room_categories');
  const bookings = db.collection('bookings');
  const reviews = db.collection('stay_reviews');

  const targetHotels = await hotels.find(buildHotelMatchFilter()).toArray();
  const targetRooms = await rooms.find(buildRelatedFilter()).toArray();
  const targetCategories = await roomCategories.find(buildRelatedFilter()).toArray();
  const targetBookings = await bookings.find(buildRelatedFilter()).toArray();
  const targetReviews = await reviews.find(buildDemoReviewFilter()).toArray();
  const users = db.collection('users');
  const targetUsers = await users.find(buildDemoUserFilter()).toArray();

  logDocuments('hotels', toPlain(targetHotels));
  logDocuments('rooms', toPlain(targetRooms));
  logDocuments('room_categories', toPlain(targetCategories));
  logDocuments('bookings', toPlain(targetBookings));
  logDocuments('stay_reviews', toPlain(targetReviews));
  logDocuments('users', toPlain(targetUsers));

  console.log('\nDeleting documents...');

  const deleteResults = {
    hotels: await hotels.deleteMany(buildHotelMatchFilter()),
    rooms: await rooms.deleteMany(buildRelatedFilter()),
    room_categories: await roomCategories.deleteMany(buildRelatedFilter()),
    bookings: await bookings.deleteMany(buildRelatedFilter()),
    stay_reviews: await reviews.deleteMany(buildDemoReviewFilter()),
    users: await users.deleteMany(buildDemoUserFilter()),
  };

  console.log('\nDeleted counts by collection:');
  for (const [collection, result] of Object.entries(deleteResults)) {
    console.log(`${collection}: ${result.deletedCount}`);
  }

  console.log('\nRemaining counts by collection:');
  for (const [collectionName, collection] of [
    ['hotels', hotels],
    ['rooms', rooms],
    ['room_categories', roomCategories],
    ['bookings', bookings],
    ['stay_reviews', reviews],
    ['users', users],
  ]) {
    const count = await collection.countDocuments();
    console.log(`${collectionName}: ${count}`);
  }

  await mongoose.disconnect();
  console.log('\nDisconnected cleanly.');
}

main().catch(async error => {
  console.error('Cleanup failed:', error);

  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors during failure cleanup
  }

  process.exitCode = 1;
});