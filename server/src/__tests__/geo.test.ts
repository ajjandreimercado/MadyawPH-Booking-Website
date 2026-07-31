import { parseCoordinate, roundDistanceKm } from '../utils/geo';

/** Mirror of frontend near-me phrase detection for API/docs consistency. */
function isNearMeQuery(raw: string): boolean {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return false;
  return [
    /\bhotels?\s+near\s+(?:near\s+)?me\b/i,
    /\bnear\s+(?:near\s+)?me\b/i,
    /\bnearby\b/i,
    /\baround\s+me\b/i,
    /\bclose\s+to\s+me\b/i,
  ].some((pattern) => pattern.test(text));
}

describe('geo utils', () => {
  it('parses coordinates', () => {
    expect(parseCoordinate('8.95')).toBeCloseTo(8.95);
    expect(parseCoordinate('abc')).toBeNull();
    expect(parseCoordinate(undefined)).toBeNull();
  });

  it('rounds distance for display', () => {
    expect(roundDistanceKm(450)).toBe(0.5);
    expect(roundDistanceKm(12500)).toBe(13);
  });

  it('detects near-me phrases', () => {
    expect(isNearMeQuery('hotel near me')).toBe(true);
    expect(isNearMeQuery('hotel near near me')).toBe(true);
    expect(isNearMeQuery('Boracay')).toBe(false);
  });
});
