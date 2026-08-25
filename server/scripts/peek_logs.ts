import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/db';

async function main() {
  await connectDatabase();
  const db = mongoose.connection.db!;
  const events = await db.collection('webhook_events').find({}).sort({ _id: -1 }).limit(3).toArray();
  console.log('webhook_events', events.map((e) => Object.keys(e)));
  const logs = await db.collection('activity_logs').find({}).sort({ _id: -1 }).limit(5).toArray();
  for (const log of logs) {
    const s = JSON.stringify(log);
    if (/qr|storage|http/i.test(s)) console.log('log', s.slice(0, 400));
  }
  await mongoose.disconnect();
}
void main();
