import type { Property } from '../types';

/**
 * Guest-facing room label: category + room number (e.g. "King · 704").
 * Falls back gracefully when either part is missing.
 */
export function formatRoomLabel(property: Pick<Property, 'name' | 'categoryName' | 'roomNumber' | 'type'>): string {
  const category = (property.categoryName ?? property.type ?? '').trim();
  const roomNo = (property.roomNumber ?? '').trim()
    || (property.name && property.name !== category ? property.name.trim() : '');

  if (category && roomNo && category.toLowerCase() !== roomNo.toLowerCase()) {
    return `${category} · ${roomNo}`;
  }
  if (category) return category;
  if (roomNo) return roomNo;
  return property.name?.trim() || 'Selected Room';
}
