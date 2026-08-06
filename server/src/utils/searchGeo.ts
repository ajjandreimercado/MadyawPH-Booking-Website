/**
 * Helpers for destination / landmark hotel search sorting.
 */

export interface SearchAnchor {
  latitude: number;
  longitude: number;
  label: string;
}

export function buildAnchorLabel(query: string, displayName?: string): string {
  const trimmed = query.trim();
  if (trimmed.length > 0 && trimmed.length <= 48) return trimmed;
  if (displayName) {
    const first = displayName.split(',')[0]?.trim();
    if (first) return first.length <= 48 ? first : `${first.slice(0, 45)}…`;
  }
  return trimmed || 'search location';
}

export function shouldSortByDistance(
  sort: string,
  nearMode: boolean,
  hasAnchor: boolean,
): boolean {
  if (nearMode || sort === 'distance') return true;
  // Landmark / city searches should default to nearest-first when we have a map point.
  if (hasAnchor && sort === 'recommended') return true;
  return false;
}
