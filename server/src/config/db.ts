import mongoose from 'mongoose';
import { MONGODB_URI, getMongoDbName } from './env';
import { invalidSummaryOnlyFilter } from '../utils/bookingHotelFields';

async function logDatabaseInventory(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const db = mongoose.connection.db;
    if (!db) return;
    const [hotels, rooms] = await Promise.all([
      db.collection('hotels').countDocuments(),
      db.collection('rooms').countDocuments(),
    ]);
    console.log(`[INFO] MongoDB database "${db.databaseName}" — hotels: ${hotels}, rooms: ${rooms}`);
    if (hotels === 0) {
      console.warn(
        '[WARN] No hotels found. Set MONGODB_URI to the hotel app cluster and ensure MONGODB_DB_NAME=hotel_hms (default).',
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[WARN] Could not read MongoDB inventory:', message);
  }
}

async function healBookingsSummaryOnly(): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.SKIP_SUMMARY_ONLY_HEAL === '1') {
    return;
  }
  try {
    const bookings = mongoose.connection.collection('bookings');
    const setTrue = await bookings.updateMany(
      { summary_only: { $in: [1, '1', 'true'] } },
      { $set: { summary_only: true } },
    );
    const setFalse = await bookings.updateMany(
      invalidSummaryOnlyFilter(),
      { $set: { summary_only: false } },
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
    const dbName = getMongoDbName();
    // maxPoolSize: limits concurrent connections.
    // serverSelectionTimeoutMS: fail fast if Atlas is unreachable.
    // socketTimeoutMS: release idle sockets after 45 s.
    await mongoose.connect(MONGODB_URI, {
      ...(dbName ? { dbName } : {}),
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8_000,
      socketTimeoutMS: 45_000,
    });
    // Log the host only — never log the full URI (it contains credentials).
    const safeUri = MONGODB_URI.replace(/:\/\/[^@]*@/, '://***:***@');
    console.log(`[INFO] Connected to MongoDB: ${safeUri}${dbName ? ` (db: ${dbName})` : ''}`);
    await healBookingsSummaryOnly();
    await logDatabaseInventory();
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