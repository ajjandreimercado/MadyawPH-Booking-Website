/**
 * Jest configuration for the Madyaw Booking API server.
 * Uses ts-jest so tests can be written in TypeScript without a separate compile step.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Sets dummy env vars (PORT, JWT_SECRET, ...) before EVERY suite loads its modules.
  // config/env.ts throws at import time when they are missing, and CI has no
  // server/.env (it is gitignored) — suites that forgot `import './testSetup'`
  // used to pass locally only because a developer .env file was present.
  setupFiles: ['<rootDir>/src/__tests__/testSetup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'CommonJS',
          esModuleInterop: true,
          resolveJsonModule: true,
          strict: false,
          skipLibCheck: true,
          types: ['node', 'jest'],
        },
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/__tests__/**'],
  testTimeout: 30_000,
};
