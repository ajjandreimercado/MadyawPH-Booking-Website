import path from 'path';
import mongoose from 'mongoose';
import { BookingModel } from './src/data/mongoModels';

// Load environment variables from server/.env — credentials must NEVER be hardcoded.
// Run as: npx ts-node fix-db.ts (from the server/ directory)
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('[fix-db] ERROR: MONGODB_URI is not set in server/.env');
  process.exit(1);
}

// Mask credentials in the log so they never appear in CI output or terminal history.
const safeUri = MONGODB_URI.replace(/:\/\/[^@]*@/, '://***:***@');
console.log(`[fix-db] Connecting to: ${safeUri}`);

mongoose.connect(MONGODB_URI)
  .then(async () => {
    try {
      const result = await BookingModel.updateMany(
        { status: 'requested' },
        { $set: { status: 'reserved', paymentMethod: 'Credit Card', roomType: 'Single' } }
      );
      console.log('Updated bookings with status=requested:', result.modifiedCount);

      const result2 = await BookingModel.updateMany(
        { paymentMethod: 'credit-card' },
        { $set: { paymentMethod: 'Credit Card' } }
      );
      console.log('Updated bookings with paymentMethod=credit-card:', result2.modifiedCount);

    } catch(e) {
      console.error('Error:', e);
    }
    process.exit(0);
  });
