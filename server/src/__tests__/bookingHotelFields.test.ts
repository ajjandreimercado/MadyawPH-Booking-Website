import { coerceSummaryOnly } from '../utils/bookingHotelFields';

describe('bookingHotelFields', () => {
  it('stores summary_only as 0|1 for hotel-app Laravel boolean validation', () => {
    expect(coerceSummaryOnly(true)).toBe(1);
    expect(coerceSummaryOnly(1)).toBe(1);
    expect(coerceSummaryOnly('1')).toBe(1);
    expect(coerceSummaryOnly(false)).toBe(0);
    expect(coerceSummaryOnly(undefined)).toBe(0);
    expect(coerceSummaryOnly(null)).toBe(0);
    expect(coerceSummaryOnly('false')).toBe(0);
    expect(coerceSummaryOnly(0)).toBe(0);
    expect(coerceSummaryOnly('')).toBe(0);
  });
});
