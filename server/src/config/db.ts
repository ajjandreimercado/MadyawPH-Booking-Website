import mongoose from 'mongoose';
import { MONGODB_URI } from './env';

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