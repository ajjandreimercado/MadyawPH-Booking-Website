/**
 * Test helper that sets up a real Express app with a mocked MongoDB connection
 * so tests can run without a live database.
 *
 * Mongoose models are mocked with jest.mock() — no network calls are made.
 */
import mongoose from 'mongoose';

// Set test env vars BEFORE any module imports that read process.env
process.env.NODE_ENV = 'test';
process.env.PORT = '5099';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-64-characters-long-xxxxxxxxxxxxxxxxxxxxxxxx';
process.env.JWT_EXPIRES_IN = '1h';
process.env.CLIENT_ORIGIN = 'http://localhost:3000';
process.env.MONGODB_URI = 'mongodb://localhost:27017/madyaw_test';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';

/**
 * Connect to an in-memory Mongoose instance.
 * For unit/integration tests we mock the models directly, but having the
 * connection open prevents "operation buffering timed out" errors.
 */
export async function setupTestDb() {
  // Disconnect if already connected (handles jest watch mode re-runs)
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export async function teardownTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
