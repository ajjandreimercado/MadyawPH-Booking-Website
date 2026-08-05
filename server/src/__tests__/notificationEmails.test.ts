import './testSetup';
import { buildRebookUrl } from '../services/notificationService';

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
