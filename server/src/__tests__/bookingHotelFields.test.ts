import { coerceSummaryOnly } from '../utils/bookingHotelFields';

describe('bookingHotelFields', () => {
  it('coerces summary_only to strict boolean for hotel reports', () => {
    expect(coerceSummaryOnly(true)).toBe(true);
    expect(coerceSummaryOnly(false)).toBe(false);
    expect(coerceSummaryOnly(undefined)).toBe(false);
    expect(coerceSummaryOnly(null)).toBe(false);
    expect(coerceSummaryOnly('false')).toBe(false);
    expect(coerceSummaryOnly(0)).toBe(false);
  });
});
