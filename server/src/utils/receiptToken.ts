import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env';

export interface ReceiptTokenPayload {
  typ: 'receipt';
  bookingId: string;
  email: string;
}

const RECEIPT_TOKEN_EXPIRES_IN = '7d';

export function signReceiptToken(bookingId: string, email: string) {
  const payload: ReceiptTokenPayload = {
    typ: 'receipt',
    bookingId: String(bookingId),
    email: email.trim().toLowerCase(),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: RECEIPT_TOKEN_EXPIRES_IN });
}

export function verifyReceiptToken(token: string): ReceiptTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET) as Partial<ReceiptTokenPayload>;
  if (payload.typ !== 'receipt' || !payload.bookingId || !payload.email) {
    throw new Error('Invalid receipt token.');
  }
  return {
    typ: 'receipt',
    bookingId: String(payload.bookingId),
    email: String(payload.email).trim().toLowerCase(),
  };
}
