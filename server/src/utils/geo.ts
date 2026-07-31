/**
 * Shared helpers for geo near-me hotel search (server).
 */

export function parseCoordinate(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function roundDistanceKm(meters: number): number {
  const km = meters / 1000;
  if (km < 10) return Math.round(km * 10) / 10;
  return Math.round(km);
}
