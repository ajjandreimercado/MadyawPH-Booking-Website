import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();

const collections = await db.listCollections().toArray();
console.log('Collections:\n' + collections.map(c => c.name).sort().join('\n'));

const cats = await db.collection('room_categories').find({}).limit(3).toArray();
console.log('\nroom_categories sample:', JSON.stringify(cats.map(c => ({ _id: c._id, name: c.name, image_url: c.image_url })), null, 2));

const hotels = await db.collection('hotels').find({}).limit(3).toArray();
console.log('\nhotels sample:', JSON.stringify(hotels.map(h => ({ _id: h._id, name: h.name, image_url: h.image_url })), null, 2));

await client.close();
