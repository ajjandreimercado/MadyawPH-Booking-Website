import mongoose from 'mongoose';

/** "Gloreto Luxury Hotel" → "GL"; a one-word name uses its first two letters. */
export function hotelInitials(hotelName: string): string {
  const words = hotelName.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const letters = words.length >= 2
    ? words.slice(0, 2).map((word) => word[0]).join('')
    : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase().padEnd(2, 'X');
}

export function formatBookingReference(initials: string, sequence: number): string {
  return `M-${initials}-${String(sequence).padStart(5, '0')}`;
}

/**
 * Reserve `count` consecutive guest-facing booking numbers (M-GL-00890). The counter is kept
 * per initials, not per hotel, so two hotels with the same initials never share a number.
 */
export async function nextBookingReferences(hotelName: string, count: number): Promise<string[]> {
  const initials = hotelInitials(hotelName);
  const db = mongoose.connection.db;
  let last: number;
  try {
    if (!db) throw new Error('no database connection');
    const counter = await db.collection<{ _id: string; seq: number }>('booking_counters').findOneAndUpdate(
      { _id: `web:${initials}` },
      { $inc: { seq: count } },
      { upsert: true, returnDocument: 'after' },
    );
    last = Number(counter?.seq);
    if (!Number.isFinite(last)) throw new Error('counter missing');
  } catch (error) {
    // ponytail: time-based fallback keeps booking possible if the counter is unavailable.
    console.warn('[Bookings] Booking counter failed, using a time-based number:', error instanceof Error ? error.message : error);
    last = (Date.now() % 100000) + count - 1;
  }
  return Array.from({ length: count }, (_, i) => formatBookingReference(initials, last - count + 1 + i));
}
