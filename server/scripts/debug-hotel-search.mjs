import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db();

const hotelCount = await db.collection('hotels').countDocuments();
const roomCount = await db.collection('rooms').countDocuments();
console.log('hotels:', hotelCount, 'rooms:', roomCount);

const sampleRoom = await db.collection('rooms').findOne({});
console.log('\nSample room hotel_id type:', typeof sampleRoom?.hotel_id, sampleRoom?.hotel_id);
console.log('Sample room price:', sampleRoom?.price_per_night, 'status:', sampleRoom?.status);

const gloretoId = '6a34ab5d79d95cdfca01b82c';
const roomsForGloreto = await db.collection('rooms').find({ hotel_id: gloretoId }).limit(3).toArray();
console.log('\nGloreto rooms (string hotel_id):', roomsForGloreto.length);

const hotel = await db.collection('hotels').findOne({ _id: new ObjectId(gloretoId) });
console.log('Gloreto hotel found:', hotel?.name);

// Simulate search minPrice logic
const rooms = await db.collection('rooms').find({}).toArray();
const hotelStatsMap = new Map();
for (const room of rooms) {
  const hid = String(room.hotel_id ?? '');
  if (!hid) continue;
  const existing = hotelStatsMap.get(hid) ?? { minPrice: Infinity, count: 0 };
  existing.count += 1;
  const price = Number(room.price_per_night ?? 0);
  if (price > 0 && price < existing.minPrice) existing.minPrice = price;
  hotelStatsMap.set(hid, existing);
}

const withPrice = [...hotelStatsMap.entries()].filter(([, s]) => s.minPrice !== Infinity && s.minPrice > 0);
console.log('\nHotels with rooms and minPrice > 0:', withPrice.length);
console.log('Sample:', withPrice.slice(0, 5).map(([id, s]) => ({ id, minPrice: s.minPrice, rooms: s.count })));

const hotelIds = withPrice.map(([id]) => id);
const objectIds = hotelIds.filter((id) => /^[a-f0-9]{24}$/i.test(id)).map((id) => new ObjectId(id));
const matchedHotels = await db.collection('hotels').find({ _id: { $in: objectIds } }).toArray();
console.log('\nMatched hotel docs for priced rooms:', matchedHotels.length, 'of', hotelIds.length);

const zeroPriceRooms = await db.collection('rooms').countDocuments({ $or: [{ price_per_night: { $lte: 0 } }, { price_per_night: { $exists: false } }] });
console.log('\nRooms with zero/missing price:', zeroPriceRooms);

const typeAgg = await db.collection('rooms').aggregate([
  { $group: { _id: { $type: '$hotel_id' }, count: { $sum: 1 } } },
]).toArray();
console.log('\nhotel_id BSON types in rooms:', typeAgg);

const noCity = await db.collection('hotels').countDocuments({
  $or: [{ city: { $exists: false } }, { city: null }, { city: '' }],
});
console.log('Hotels missing city field:', noCity, '/', hotelCount);

await client.close();
