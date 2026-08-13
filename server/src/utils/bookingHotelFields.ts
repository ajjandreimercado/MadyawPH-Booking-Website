/**
 * Shared booking fields required by the hotel management app (reports, forms).
 */

/** Hotel app reports reject non-boolean summary_only (null, string, missing). */
export function coerceSummaryOnly(value: unknown): boolean {
  return value === true;
}

/** Mongo filter: bookings whose summary_only is not a strict boolean. */
export function invalidSummaryOnlyFilter(): Record<string, unknown> {
  return {
    $or: [
      { summary_only: { $exists: false } },
      { summary_only: { $nin: [true, false] } },
    ],
  };
}
