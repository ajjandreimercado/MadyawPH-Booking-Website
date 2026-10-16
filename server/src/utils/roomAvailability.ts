/**
 * Date-based room availability shared by hotel detail, search and booking creation.
 *
 * Bookings live in one `bookings` collection written by both the website (propertyId,
 * checkInDate strings) and the hotel app (room_id, check_in_date Dates), so every check
 * looks at both field families.
 */

import type mongoose from 'mongoose';
import { BookingModel } from '../data/mongoModels';

/** Statuses that hold a room for their dates (website + hotel-app vocabulary). */
export const ROOM_HOLD_STATUSES = [
  'requested', 'accepted', 'paid', 'confirmed', 'pending', 'reserved', 'booked',
  'checked_in', 'checked-in', 'checkedin', 'in_house', 'occupied',
];

/** Website requests the hotel has not reviewed yet. */
const UNREVIEWED_STATUSES = new Set(['pending', 'requested']);

/** An unreviewed request stops holding the room after this long (the hotel app re-checks on approval). */
export const PENDING_HOLD_MS = 48 * 60 * 60 * 1000;

/** Room statuses that make a room unbookable for any dates. */
const OUT_OF_SERVICE_STATUSES = new Set([
  'maintenance', 'under_maintenance', 'out_of_order', 'out-of-order', 'out_of_service', 'inactive', 'disabled',
]);

type BookingLike = Record<string, unknown>;

function toDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function bookingStayRange(booking: BookingLike): { start: Date; end: Date } | null {
  const start = toDate(booking.checkInDate ?? booking.check_in_date ?? booking.check_in_at);
  const end = toDate(booking.checkOutDate ?? booking.check_out_date ?? booking.check_out_at);
  return start && end ? { start, end } : null;
}

/** True when this booking still blocks its room (expired unreviewed requests do not). */
export function bookingHoldsRoom(booking: BookingLike, now: number = Date.now()): boolean {
  const status = String(booking.status ?? '').toLowerCase();
  if (!ROOM_HOLD_STATUSES.includes(status)) return false;
  if (!UNREVIEWED_STATUSES.has(status)) return true;
  const requestedAt = toDate(booking.requestedAt ?? booking.createdAt ?? booking.created_at);
  return !requestedAt || now - requestedAt.getTime() < PENDING_HOLD_MS;
}

export function isRoomOutOfService(room: { status?: unknown }): boolean {
  return OUT_OF_SERVICE_STATUSES.has(String(room.status ?? '').toLowerCase());
}

/** Parse a yyyy-MM-dd check-in/check-out pair; null when missing or not a forward range. */
export function parseStayQuery(checkIn: unknown, checkOut: unknown): { start: Date; end: Date } | null {
  if (typeof checkIn !== 'string' || typeof checkOut !== 'string') return null;
  const start = toDate(checkIn);
  const end = toDate(checkOut);
  return start && end && end > start ? { start, end } : null;
}

/** Room ids (from the given list) that have a holding booking overlapping [start, end). */
export async function findBookedRoomIds(
  roomIds: string[],
  start: Date,
  end: Date,
  options: { excludeBookingId?: string; session?: mongoose.ClientSession | null } = {},
): Promise<Set<string>> {
  const booked = new Set<string>();
  if (roomIds.length === 0) return booked;

  const query = BookingModel.find({
    $or: [{ propertyId: { $in: roomIds } }, { room_id: { $in: roomIds } }],
    status: { $in: ROOM_HOLD_STATUSES },
  }).select({
    propertyId: 1, room_id: 1, status: 1, checkInDate: 1, checkOutDate: 1, check_in_date: 1,
    check_out_date: 1, check_in_at: 1, check_out_at: 1, requestedAt: 1, createdAt: 1, created_at: 1,
  });
  if (options.session) query.session(options.session);
  const bookings = (await query.lean()) as BookingLike[];

  const wanted = new Set(roomIds);
  const now = Date.now();
  for (const booking of bookings) {
    if (options.excludeBookingId && String(booking._id) === options.excludeBookingId) continue;
    if (!bookingHoldsRoom(booking, now)) continue;
    const range = bookingStayRange(booking);
    if (!range || !(start < range.end && end > range.start)) continue;
    for (const id of [booking.propertyId, booking.room_id]) {
      if (id != null && wanted.has(String(id))) booked.add(String(id));
    }
  }
  return booked;
}

/**
 * Can this room be booked for the stay? Out-of-service rooms never can. For a stay starting
 * today the room must also be physically available right now (an occupied room may not be
 * recorded as a booking); later stays ignore today's housekeeping status.
 */
export function isRoomBookable(
  room: { _id?: unknown; status?: unknown },
  bookedIds: Set<string>,
  stayStart: Date,
  now: Date = new Date(),
): boolean {
  if (isRoomOutOfService(room)) return false;
  if (bookedIds.has(String(room._id))) return false;
  const startsToday = stayStart.toISOString().slice(0, 10) <= manilaToday(now);
  return startsToday ? String(room.status ?? 'available').toLowerCase() === 'available' : true;
}

/** Today's date (yyyy-MM-dd) in Asia/Manila, where the hotels are. */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
}
