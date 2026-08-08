/**
 * Build search filter options from live hotel-app room/hotel data
 * and normalize amenity / room-type matching for /hotels/search.
 */

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeFilterToken(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function displayFilterLabel(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  // Keep hotel-app labels like "Double" / "Single Bed" readable.
  if (/[A-Z]/.test(trimmed) && trimmed.includes(' ')) return trimmed;
  return trimmed
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Map common amenity selections onto hotel-app boolean room fields. */
export function amenityBooleanField(token: string): 'free_cancellation' | 'breakfast_included' | null {
  const key = normalizeFilterToken(token);
  if (
    key === 'free-cancellation'
    || key === 'freecancellation'
    || key === 'free-cancel'
    || key === 'cancellation'
  ) {
    return 'free_cancellation';
  }
  if (
    key === 'breakfast-included'
    || key === 'breakfast'
    || key === 'free-breakfast'
    || key === 'breakfastincluded'
  ) {
    return 'breakfast_included';
  }
  return null;
}

export function collectAmenityValues(...sources: unknown[]): string[] {
  const out = new Set<string>();

  const push = (value: unknown) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === 'string') {
      // Hotel app sometimes stores CSV amenities.
      const parts = value.includes(',') ? value.split(',') : [value];
      for (const part of parts) {
        const label = String(part).trim();
        if (label && label.length <= 80) out.add(label);
      }
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      // e.g. { wifi: true, pool: false }
      for (const [key, enabled] of Object.entries(record)) {
        if (enabled === true || enabled === 'true' || enabled === 1) {
          const label = displayFilterLabel(key);
          if (label) out.add(label);
        }
      }
    }
  };

  sources.forEach(push);
  return Array.from(out);
}

export function uniqueSortedLabels(values: unknown[]): string[] {
  const byNorm = new Map<string, string>();
  for (const value of values) {
    const label = String(value ?? '').trim();
    if (!label || label.length > 80) continue;
    const norm = normalizeFilterToken(label);
    if (!norm) continue;
    if (!byNorm.has(norm)) byNorm.set(norm, label);
  }
  return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function isSafeFilterValue(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > 80) return false;
  // Allow hotel-app labels like "Double", "Air Conditioning", "Wi-Fi".
  return /^[\w\s.&+/()-]+$/u.test(value);
}

export function buildAmenityRoomClause(amenity: string): Record<string, unknown> | null {
  if (!isSafeFilterValue(amenity)) return null;
  const boolField = amenityBooleanField(amenity);
  if (boolField) return { [boolField]: true };

  const pattern = escapeRegex(amenity.trim());
  return {
    $or: [
      { amenities: { $regex: `^${pattern}$`, $options: 'i' } },
      { amenities: { $regex: pattern, $options: 'i' } },
      { facilities: { $regex: pattern, $options: 'i' } },
      { features: { $regex: pattern, $options: 'i' } },
      { hotel_amenities: { $regex: pattern, $options: 'i' } },
      { description: { $regex: pattern, $options: 'i' } },
    ],
  };
}
