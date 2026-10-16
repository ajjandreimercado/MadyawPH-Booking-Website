import './testSetup';
import {
  bookingHoldsRoom,
  bookingStayRange,
  isRoomBookable,
  parseStayQuery,
  PENDING_HOLD_MS,
} from '../utils/roomAvailability';

const NOW = new Date('2026-10-17T04:00:00Z'); // Oct 17, noon in Manila

describe('bookingHoldsRoom', () => {
  it('counts confirmed and checked-in stays (website and hotel-app statuses)', () => {
    expect(bookingHoldsRoom({ status: 'reserved' }, NOW.getTime())).toBe(true);
    expect(bookingHoldsRoom({ status: 'checked_in' }, NOW.getTime())).toBe(true);
    expect(bookingHoldsRoom({ status: 'cancelled' }, NOW.getTime())).toBe(false);
    expect(bookingHoldsRoom({ status: 'declined' }, NOW.getTime())).toBe(false);
  });

  it('lets an unreviewed request hold the room for 48 hours only', () => {
    const fresh = new Date(NOW.getTime() - 60 * 60 * 1000);
    const stale = new Date(NOW.getTime() - PENDING_HOLD_MS - 1);
    expect(bookingHoldsRoom({ status: 'pending', requestedAt: fresh.toISOString() }, NOW.getTime())).toBe(true);
    expect(bookingHoldsRoom({ status: 'pending', requestedAt: stale.toISOString() }, NOW.getTime())).toBe(false);
  });
});

describe('bookingStayRange', () => {
  it('reads website and hotel-app date fields', () => {
    expect(bookingStayRange({ checkInDate: '2026-10-18', checkOutDate: '2026-10-19' })?.end.toISOString())
      .toBe('2026-10-19T00:00:00.000Z');
    expect(bookingStayRange({ check_in_date: new Date('2026-10-18'), check_out_date: new Date('2026-10-20') }))
      .not.toBeNull();
    expect(bookingStayRange({})).toBeNull();
  });
});

describe('isRoomBookable', () => {
  const tomorrow = new Date('2026-10-18T00:00:00Z');
  const today = new Date('2026-10-17T00:00:00Z');

  it('ignores today\'s housekeeping status for future stays', () => {
    expect(isRoomBookable({ _id: 'r1', status: 'occupied' }, new Set(), tomorrow, NOW)).toBe(true);
  });

  it('requires the room to be available now for a stay starting today', () => {
    expect(isRoomBookable({ _id: 'r1', status: 'occupied' }, new Set(), today, NOW)).toBe(false);
    expect(isRoomBookable({ _id: 'r1', status: 'available' }, new Set(), today, NOW)).toBe(true);
  });

  it('never books rooms that are booked for the dates or out of service', () => {
    expect(isRoomBookable({ _id: 'r1', status: 'available' }, new Set(['r1']), tomorrow, NOW)).toBe(false);
    expect(isRoomBookable({ _id: 'r1', status: 'maintenance' }, new Set(), tomorrow, NOW)).toBe(false);
  });
});

describe('parseStayQuery', () => {
  it('accepts only a forward date range', () => {
    expect(parseStayQuery('2026-10-18', '2026-10-19')).not.toBeNull();
    expect(parseStayQuery('2026-10-19', '2026-10-18')).toBeNull();
    expect(parseStayQuery(undefined, '2026-10-18')).toBeNull();
  });
});
