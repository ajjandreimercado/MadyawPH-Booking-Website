import { coerceSummaryOnly, toHotelRoomId } from '../utils/bookingHotelFields';

describe('bookingHotelFields', () => {
  it('keeps summary_only a strict boolean, never null/""/missing', () => {
    expect(coerceSummaryOnly(true)).toBe(true);
    expect(coerceSummaryOnly(1)).toBe(true);
    expect(coerceSummaryOnly('1')).toBe(true);
    expect(coerceSummaryOnly(false)).toBe(false);
    expect(coerceSummaryOnly(0)).toBe(false);
    expect(coerceSummaryOnly(undefined)).toBe(false);
    expect(coerceSummaryOnly(null)).toBe(false);
    expect(coerceSummaryOnly('')).toBe(false);
  });

  it('writes room_id as the string form hotel bookings use', () => {
    expect(toHotelRoomId('68f0a1b2c3d4e5f6a7b8c9d0')).toBe('68f0a1b2c3d4e5f6a7b8c9d0');
    expect(toHotelRoomId({ toString: () => 'room-1' })).toBe('room-1');
    expect(toHotelRoomId(null)).toBe('');
  });
});
