import './testSetup';
import {
  cityKey, codeFromSequence, formatBookingNumber, manilaStamp, nextBookingReferences,
} from '../utils/bookingReference';

describe('booking numbers CC-HH-T-YYMMDD-HHMM', () => {
  it('turns a sequence into 2-letter codes', () => {
    expect(codeFromSequence(1)).toBe('AA');
    expect(codeFromSequence(2)).toBe('AB');
    expect(codeFromSequence(27)).toBe('BA');
    expect(codeFromSequence(676)).toBe('ZZ');
    expect(() => codeFromSequence(677)).toThrow();
  });

  it('treats "Butuan City" and "butuan" as one city', () => {
    expect(cityKey('Butuan City')).toBe('butuan');
    expect(cityKey('City of Cabadbaran')).toBe('cabadbaran');
    expect(cityKey('')).toBe('unassigned');
  });

  it('uses the Manila date and 24-hour time with leading zeros', () => {
    // 2026-10-23 15:32 Manila = 07:32 UTC
    expect(manilaStamp(new Date('2026-10-23T07:32:00Z'))).toEqual({ date: '261023', time: '1532' });
    // 2026-01-05 03:05 and 15:05 Manila; 00:07 Manila is the previous day in UTC
    expect(manilaStamp(new Date('2026-01-04T19:05:00Z')).time).toBe('0305');
    expect(manilaStamp(new Date('2026-01-05T07:05:00Z'))).toEqual({ date: '260105', time: '1505' });
    expect(manilaStamp(new Date('2026-01-04T16:07:00Z'))).toEqual({ date: '260105', time: '0007' });
  });

  it('formats the example number', () => {
    expect(formatBookingNumber('AA', 'AB', 'walk_in', new Date('2026-10-23T07:32:00Z'))).toBe('AA-AB-W-261023-1532');
    expect(formatBookingNumber('AA', 'AB', 'online', new Date('2026-10-23T07:32:00Z'))).toBe('AA-AB-O-261023-1532');
  });

  it('never repeats a number: a clash moves to the next minute', async () => {
    const refs = await nextBookingReferences('hotel-x', 3);
    expect(new Set(refs).size).toBe(3);
    refs.forEach((ref) => expect(ref).toMatch(/^[A-Z]{2}-[A-Z]{2}-O-\d{6}-\d{4}$/));
    const minutes = refs.map((ref) => Number(ref.slice(-4)));
    expect(minutes[1]).not.toBe(minutes[0]);
  });
});
