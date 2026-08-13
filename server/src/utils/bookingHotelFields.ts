/**
 * Shared booking fields required by the hotel management app (reports, forms).
 *
 * Hotel Laravel reports use the `boolean` rule, which accepts true/false/0/1/"0"/"1"
 * but NOT empty string. Some PHP Mongo layers turn BSON `false` into `""`, which
 * then fails with "The summary only field must be true or false."
 * Persist 0 | 1 so the value survives that round-trip.
 */

export type SummaryOnlyFlag = 0 | 1;

export function coerceSummaryOnly(value: unknown): SummaryOnlyFlag {
  if (value === true || value === 1 || value === '1') return 1;
  return 0;
}

/** Mongo filter: bookings whose summary_only is not an integer 0/1 flag. */
export function invalidSummaryOnlyFilter(): Record<string, unknown> {
  return {
    summary_only: { $nin: [0, 1] },
  };
}
