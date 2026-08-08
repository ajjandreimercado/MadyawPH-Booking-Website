import {
  amenityBooleanField,
  buildAmenityRoomClause,
  collectAmenityValues,
  isSafeFilterValue,
  normalizeFilterToken,
  uniqueSortedLabels,
} from '../utils/searchFilters';

describe('searchFilters', () => {
  it('normalizes amenity tokens', () => {
    expect(normalizeFilterToken('Wi Fi')).toBe('wi-fi');
    expect(normalizeFilterToken('Air_Conditioning')).toBe('air-conditioning');
  });

  it('maps breakfast / free cancellation to room boolean fields', () => {
    expect(amenityBooleanField('Breakfast Included')).toBe('breakfast_included');
    expect(amenityBooleanField('free cancellation')).toBe('free_cancellation');
    expect(amenityBooleanField('wifi')).toBeNull();
  });

  it('collects amenities from arrays, CSV, and flag objects', () => {
    expect(collectAmenityValues(
      ['WiFi', 'Pool'],
      'Parking, Gym',
      { spa: true, laundry: false },
    )).toEqual(expect.arrayContaining(['WiFi', 'Pool', 'Parking', 'Gym', 'Spa']));
  });

  it('dedupes labels case-insensitively', () => {
    expect(uniqueSortedLabels(['wifi', 'WiFi', 'Pool'])).toEqual(['Pool', 'wifi']);
  });

  it('rejects unsafe filter values', () => {
    expect(isSafeFilterValue('Double')).toBe(true);
    expect(isSafeFilterValue('Air Conditioning')).toBe(true);
    expect(isSafeFilterValue('{ $gt: 1 }')).toBe(false);
  });

  it('builds amenity room clauses for text and boolean amenities', () => {
    expect(buildAmenityRoomClause('Breakfast Included')).toEqual({ breakfast_included: true });
    const wifi = buildAmenityRoomClause('WiFi');
    expect(wifi).toHaveProperty('$or');
  });
});
