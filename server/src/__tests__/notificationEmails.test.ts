import './testSetup';
import { buildRebookUrl, formatStayDate, formatStayLength, senderFor } from '../services/notificationService';

describe('buildRebookUrl', () => {
  it('prefers the hotel detail page when hotel_id is present', () => {
    const url = buildRebookUrl({
      hotel_id: 'hotel-123',
      propertyId: 'room-9',
    });
    expect(url).toBe('http://localhost:3000/hotels/hotel-123');
  });

  it('falls back to booking page with dates when only propertyId exists', () => {
    const url = buildRebookUrl({
      propertyId: 'room-9',
      checkInDate: '2026-08-10',
      checkOutDate: '2026-08-12',
    });
    expect(url).toContain('/booking/room-9');
    expect(url).toContain('checkIn=2026-08-10');
    expect(url).toContain('checkOut=2026-08-12');
  });
});

describe('email formatting', () => {
  it('formats stay dates as month-day-year', () => {
    expect(formatStayDate('2026-10-18', 'x')).toBe('Oct 18, 2026');
    expect(formatStayDate(undefined, 'your check-in date')).toBe('your check-in date');
  });

  it('describes the stay length in nights', () => {
    expect(formatStayLength({ nights: 1 })).toBe('1 night');
    expect(formatStayLength({ checkInDate: '2026-10-18', checkOutDate: '2026-10-21' })).toBe('3 nights');
    expect(formatStayLength({})).toBe('');
  });

  it('sends in the hotel name from the configured address', () => {
    process.env.EMAIL_FROM = 'Madyaw Bookings <noreply@madyaw.com>';
    expect(senderFor('Gloreto Luxury Hotel')).toBe('Gloreto Luxury Hotel <noreply@madyaw.com>');
    expect(senderFor('Bad "<x>"\r\nName')).toBe('Bad xName <noreply@madyaw.com>');
  });
});
