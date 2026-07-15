/**
 * Jest configuration for the Madyaw Booking API server.
 * Uses ts-jest so tests can be written in TypeScript without a separate compile step.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/__tests__/**'],
  // Increase timeout for async operations in tests
  testTimeout: 30_000,
};
