/**
 * Keep website-written booking documents shaped like the hotel management app's
 * own documents in shared MongoDB (verified against hotel-created bookings).
 */

/**
 * `summary_only` is only ever written by this website — the hotel app leaves it
 * off its own bookings. Store a real boolean so any Laravel boolean rule/cast on
 * the hotel side accepts it, and never leave it null/""/missing.
 */
export function coerceSummaryOnly(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/** Mongo filter: bookings whose summary_only is not a strict boolean. */
export function invalidSummaryOnlyFilter(): Record<string, unknown> {
  return {
    summary_only: { $nin: [true, false] },
  };
}

/**
 * Hotel bookings store room_id as the string form of the room's ObjectId.
 * Writing a raw ObjectId here makes hotel-side room lookups/reports miss
 * website bookings, so always persist the string form.
 */
export function toHotelRoomId(value: unknown): string {
  return String(value ?? '');
}
