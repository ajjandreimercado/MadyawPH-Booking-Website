import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/db';

async function test() {
  await connectDatabase();
  try {
    const db = mongoose.connection.db;
    if (!db) return;
    const hotels = await db.collection('hotels').find({}).toArray();
    console.log('All hotels image fields:');
    hotels.forEach(h => console.log(h._id, 'image:', h.image, 'image_url:', h.image_url, 'imageUrl:', h.imageUrl, 'images:', h.images));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}
test();
