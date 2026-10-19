/**
 * Date-based room availability shared by hotel detail, search and booking creation.
 *
 * Bookings live in one `bookings` collection written by both the website (propertyId,
 * checkInDate strings) and the hotel app (room_id, check_in_date Dates), so every check
 * looks at both field families.
 */

import type mongoose from 'mongoose';
import { BookingModel, PropertyModel } from '../data/mongoModels';

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

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Hotel app defaults: check-in 14:00, check-out 11:00 (Asia/Manila). */
export const DEFAULT_CHECK_IN = '14:00';
export const DEFAULT_CHECK_OUT = '11:00';

/** yyyy-MM-dd of a stay date as the hotel sees it (Asia/Manila), from a string or Date. */
export function stayDateOf(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = toDate(raw);
  if (!date) return null;
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Wall-clock time on a stay date in the hotel's timezone (UTC+8). */
export function hotelTime(date: string, time: string): Date {
  return new Date(`${date}T${TIME_RE.test(time) ? time : DEFAULT_CHECK_IN}:00+08:00`);
}

/**
 * The time a booking actually holds its room: check-in date + check-in time to check-out
 * date + check-out time (defaults 14:00 / 11:00), like the hotel app. Back-to-back nightly
 * stays don't collide, and hourly stays only block their hours.
 */
export function bookingStayRange(booking: BookingLike): { start: Date; end: Date } | null {
  const inDay = stayDateOf(booking.checkInDate ?? booking.check_in_date ?? booking.check_in_at);
  const outDay = stayDateOf(booking.checkOutDate ?? booking.check_out_date ?? booking.check_out_at);
  if (!inDay || !outDay) return null;
  const inTime = String(booking.check_in_time ?? '').trim();
  const outTime = String(booking.check_out_time ?? '').trim();
  const start = hotelTime(inDay, TIME_RE.test(inTime) ? inTime : DEFAULT_CHECK_IN);
  const end = hotelTime(outDay, TIME_RE.test(outTime) ? outTime : DEFAULT_CHECK_OUT);
  return end > start ? { start, end } : null;
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

/**
 * Parse a yyyy-MM-dd check-in/check-out pair into the nightly window it holds
 * (check-in 14:00 → check-out 11:00, hotel time); null when missing or not a forward range.
 */
export function parseStayQuery(checkIn: unknown, checkOut: unknown): { start: Date; end: Date } | null {
  if (typeof checkIn !== 'string' || typeof checkOut !== 'string') return null;
  const inDay = stayDateOf(checkIn);
  const outDay = stayDateOf(checkOut);
  if (!inDay || !outDay || outDay <= inDay) return null;
  return { start: hotelTime(inDay, DEFAULT_CHECK_IN), end: hotelTime(outDay, DEFAULT_CHECK_OUT) };
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
    check_out_date: 1, check_in_at: 1, check_out_at: 1, check_in_time: 1, check_out_time: 1,
    requestedAt: 1, createdAt: 1, created_at: 1,
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
 * Can this room be booked for the stay? Client rule: only rooms the hotel app marks vacant
 * ("available") are offered — occupied (checked_in), cleaning or out-of-service rooms are
 * hidden whatever the dates — and never a room already booked for the stay.
 */
export function isRoomBookable(
  room: { _id?: unknown; status?: unknown },
  bookedIds: Set<string>,
  _stayStart?: Date,
): boolean {
  if (bookedIds.has(String(room._id))) return false;
  return String(room.status ?? '').toLowerCase() === 'available';
}

/** Today's date (yyyy-MM-dd) in Asia/Manila, where the hotels are. */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
}

/**
 * Order rooms of one type for automatic assignment: priced rooms first (cheapest), then
 * lowest room number. Unpriced (₱0 / missing) rooms sort last so checkout never quotes ₱0
 * when another room of the same type has a real rate.
 */
export function compareRoomsForAssignment(
  a: { price: number; roomNumber?: string },
  b: { price: number; roomNumber?: string },
): number {
  const aPriced = Number(a.price) > 0;
  const bPriced = Number(b.price) > 0;
  if (aPriced !== bPriced) return aPriced ? -1 : 1;
  if (a.price !== b.price) return a.price - b.price;
  return String(a.roomNumber ?? '').localeCompare(String(b.roomNumber ?? ''), undefined, { numeric: true });
}

/** The price a room is sold at: block price for hourly rooms, nightly rate otherwise. */
export function roomListPrice(room: { billing_mode?: unknown; price_per_block?: unknown; price_per_night?: unknown }): number {
  const hourly = String(room.billing_mode ?? '').toLowerCase() === 'hourly';
  return Number((hourly ? room.price_per_block : room.price_per_night) ?? 0) || Number(room.price_per_night ?? 0) || 0;
}

/**
 * Guests book a room type, not a room: pick the room the booking is assigned to (the hotel
 * can reassign it in the hotel app). Null when no room of that type is free for the stay.
 */
export async function pickRoomForCategory(
  categoryId: string,
  start: Date,
  end: Date,
  options: { session?: mongoose.ClientSession | null } = {},
) {
  const query = PropertyModel.find({ category_id: categoryId });
  if (options.session) query.session(options.session);
  const rooms = await query.lean();
  if (rooms.length === 0) return null;
  const booked = await findBookedRoomIds(rooms.map((room) => String(room._id)), start, end, options);
  const free = rooms
    .filter((room) => isRoomBookable(room, booked, start))
    .sort((a, b) => compareRoomsForAssignment(
      { price: roomListPrice(a), roomNumber: a.room_number },
      { price: roomListPrice(b), roomNumber: b.room_number },
    ));
  return free[0] ?? null;
}
