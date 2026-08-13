import mongoose from 'mongoose';
import { MONGODB_URI } from './env';
import { invalidSummaryOnlyFilter } from '../utils/bookingHotelFields';

async function healBookingsSummaryOnly(): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.SKIP_SUMMARY_ONLY_HEAL === '1') {
    return;
  }
  try {
    const bookings = mongoose.connection.collection('bookings');
    const setTrue = await bookings.updateMany(
      { summary_only: { $in: [true, '1', 'true'] } },
      { $set: { summary_only: 1 } },
    );
    const setFalse = await bookings.updateMany(
      invalidSummaryOnlyFilter(),
      { $set: { summary_only: 0 } },
    );
    const changed = (setTrue.modifiedCount ?? 0) + (setFalse.modifiedCount ?? 0);
    if (changed > 0) {
      console.log(`[INFO] Healed summary_only on ${changed} booking(s) for hotel-app reports.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[WARN] Could not heal booking summary_only fields:', message);
  }
}

export async function connectDatabase(): Promise<void> {
  try {
    // maxPoolSize: limits concurrent connections.
    // serverSelectionTimeoutMS: fail fast if Atlas is unreachable.
    // socketTimeoutMS: release idle sockets after 45 s.
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8_000,
      socketTimeoutMS: 45_000,
    });
    // Log the host only — never log the full URI (it contains credentials).
    const safeUri = MONGODB_URI.replace(/:\/\/[^@]*@/, '://***:***@');
    console.log(`[INFO] Connected to MongoDB: ${safeUri}`);
    await healBookingsSummaryOnly();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database connection error.';
    console.error('[FATAL] Failed to connect to MongoDB:', message);
    throw error; // Re-throw so index.ts can catch and exit(1)
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[WARN] MongoDB connection lost. Mongoose will auto-reconnect.');
  });

  mongoose.connection.on('error', (err: Error) => {
    console.error('[ERROR] MongoDB runtime error:', err.message);
  });
}