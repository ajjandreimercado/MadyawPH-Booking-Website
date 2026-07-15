import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/db';

async function list() {
  await connectDatabase();
  try {
    const db = mongoose.connection.db;
    if (!db) {
      console.log('No database connection');
      return;
    }
    const collections = await db.listCollections().toArray();
    console.log('Collections in database:');
    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments();
      console.log(`- ${col.name} (${count} documents)`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

void list();
