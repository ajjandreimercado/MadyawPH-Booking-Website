import type { AuthTokenPayload } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

export {};