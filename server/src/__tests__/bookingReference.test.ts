import './testSetup';
import { formatBookingReference, hotelInitials, nextBookingReferences } from '../utils/bookingReference';

describe('booking numbers', () => {
  it('builds initials from the hotel name', () => {
    expect(hotelInitials('Gloreto Luxury Hotel')).toBe('GL');
    expect(hotelInitials('Madyaw')).toBe('MA');
    expect(hotelInitials('')).toBe('XX');
  });

  it('formats like M-GL-00890', () => {
    expect(formatBookingReference('GL', 890)).toBe('M-GL-00890');
  });

  it('gives consecutive numbers (time-based fallback without a database)', async () => {
    const refs = await nextBookingReferences('Gloreto Luxury Hotel', 3);
    expect(refs).toHaveLength(3);
    const numbers = refs.map((ref) => Number(ref.split('-')[2]));
    expect(numbers[1]).toBe(numbers[0] + 1);
    expect(numbers[2]).toBe(numbers[0] + 2);
    expect(refs[0]).toMatch(/^M-GL-\d{5}$/);
  });
});
