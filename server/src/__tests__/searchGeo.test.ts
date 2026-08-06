import { buildAnchorLabel, shouldSortByDistance } from '../utils/searchGeo';

describe('searchGeo', () => {
  it('buildAnchorLabel prefers short user query', () => {
    expect(buildAnchorLabel('FSUU', 'Father Saturnino Urios University, Butuan')).toBe('FSUU');
  });

  it('buildAnchorLabel falls back to display name', () => {
    const label = buildAnchorLabel(
      'a very long landmark name that exceeds the display limit for labels',
      'Butuan City, Agusan del Norte, Philippines',
    );
    expect(label).toBe('Butuan City');
  });

  it('shouldSortByDistance for near-me and explicit distance', () => {
    expect(shouldSortByDistance('recommended', true, false)).toBe(true);
    expect(shouldSortByDistance('distance', false, false)).toBe(true);
  });

  it('shouldSortByDistance for geocoded destination defaults recommended to distance', () => {
    expect(shouldSortByDistance('recommended', false, true)).toBe(true);
    expect(shouldSortByDistance('price', false, true)).toBe(false);
  });
});
