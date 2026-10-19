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
      // Check-out 11:00 hotel time (UTC+8), like the hotel app.
      .toBe('2026-10-19T03:00:00.000Z');
    expect(bookingStayRange({ check_in_date: new Date('2026-10-18'), check_out_date: new Date('2026-10-20') }))
      .not.toBeNull();
    expect(bookingStayRange({})).toBeNull();
  });
});

describe('isRoomBookable', () => {
  it('offers only rooms the hotel app marks vacant (available)', () => {
    expect(isRoomBookable({ _id: 'r1', status: 'available' }, new Set())).toBe(true);
    expect(isRoomBookable({ _id: 'r1', status: 'checked_in' }, new Set())).toBe(false);
    expect(isRoomBookable({ _id: 'r1', status: 'cleaning' }, new Set())).toBe(false);
    expect(isRoomBookable({ _id: 'r1', status: 'maintenance' }, new Set())).toBe(false);
  });

  it('never offers a vacant room that is already booked for the dates', () => {
    expect(isRoomBookable({ _id: 'r1', status: 'available' }, new Set(['r1']))).toBe(false);
  });
});

describe('parseStayQuery', () => {
  it('accepts only a forward date range', () => {
    expect(parseStayQuery('2026-10-18', '2026-10-19')).not.toBeNull();
    expect(parseStayQuery('2026-10-19', '2026-10-18')).toBeNull();
    expect(parseStayQuery(undefined, '2026-10-18')).toBeNull();
  });
});
