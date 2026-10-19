/**
 * Stay pricing ported from the hotel app (MADYAWPH) so website prices match what the hotel
 * charges: CustomerStayPricing::resolveStayWindow, RoomBillingSupport::computeStayCharge /
 * hourlyConfig, FinancialComputationService and RoomPricingService::applySurge.
 * Keep in sync with those files when the hotel app's pricing changes.
 */

import mongoose from 'mongoose';
import { PropertyModel, RoomCategoryModel } from '../data/mongoModels';
import { loadHotelSystemSettings } from './paymentQr';

/** Website default arrival when the guest picks none (hotel check-in starts 2 PM). */
export const DEFAULT_CHECK_IN_TIME = '14:00';
/** Hotel app CustomerStayPricing::DEFAULT_HOURLY_CHECK_OUT_HOUR. */
export const CHECK_OUT_TIME = '11:00';
/** Hotel app RoomBillingSupport::DEFAULT_BLOCK_HOURS. */
export const DEFAULT_BLOCK_HOURS = 3;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOUR_MS = 60 * 60 * 1000;

type Doc = Record<string, unknown>;

function num(value: unknown): number {
  if (value && typeof value === 'object' && '$numberDecimal' in (value as Doc)) {
    return Number((value as { $numberDecimal?: string }).$numberDecimal ?? 0) || 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** PriceRounding::nearest50 — round pesos to the nearest ₱50 (520 → 500, 530 → 550). */
export function nearest50(amount: number): number {
  if (!(amount > 0)) return 0;
  return Math.round(amount / 50) * 50;
}

export function isHourlyRoom(room: Doc): boolean {
  return String(room.billing_mode ?? '').trim().toLowerCase() === 'hourly';
}

/** RoomBillingSupport::hourlyConfig — the category is the source of truth for block length. */
export function hourlyConfig(room: Doc, category?: Doc | null): { pricePerBlock: number; blockHours: number } {
  let price = nearest50(num(room.price_per_block));
  let blockHours = Math.trunc(num(category?.block_hours));
  if (blockHours < 1) blockHours = Math.trunc(num(room.block_hours));
  if (blockHours < 1) blockHours = DEFAULT_BLOCK_HOURS;
  if (price <= 0 && category) {
    price = nearest50(num(category.price_per_block));
    if (price <= 0) price = nearest50(num(category.default_price));
  }
  if (price <= 0) price = nearest50(num(room.price_per_night));
  return { pricePerBlock: price, blockHours };
}

/** Wall-clock time in the hotel's timezone (Asia/Manila, UTC+8, no DST). */
function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+08:00`);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function manilaParts(d: Date): { date: string; time: string } {
  const local = new Date(d.getTime() + 8 * HOUR_MS);
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) };
}

export interface StayWindow {
  start: Date;
  end: Date;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
}

/**
 * CustomerStayPricing::resolveStayWindow with the guest's arrival time as the clock time.
 * Nightly: check-out at 11:00 on the check-out day (same day → next day). Hourly: same day →
 * one block from arrival; multi-day → 11:00 on the check-out day.
 */
export function resolveStayWindow(
  room: Doc,
  category: Doc | null | undefined,
  checkInDate: string,
  checkOutDate: string,
  arrivalTime?: string,
): StayWindow {
  const inDay = checkInDate.slice(0, 10);
  let outDay = checkOutDate.slice(0, 10);
  if (outDay < inDay) throw new Error('Check-out must be on or after check-in.');
  const time = arrivalTime && TIME_RE.test(arrivalTime) ? arrivalTime : DEFAULT_CHECK_IN_TIME;
  const start = at(inDay, time);
  let end: Date;
  if (isHourlyRoom(room)) {
    const { blockHours } = hourlyConfig(room, category);
    end = outDay > inDay ? at(outDay, CHECK_OUT_TIME) : new Date(start.getTime() + blockHours * HOUR_MS);
    if (end <= start) end = new Date(start.getTime() + blockHours * HOUR_MS);
  } else {
    if (outDay === inDay) outDay = addDays(inDay, 1);
    end = at(outDay, CHECK_OUT_TIME);
  }
  const outParts = manilaParts(end);
  return { start, end, checkInDate: inDay, checkOutDate: outParts.date, checkInTime: time, checkOutTime: outParts.time };
}

/** RoomPricingService::applySurge — markup when "booked" rooms exceed the hotel's threshold. */
export async function surgeFor(hotelId: string): Promise<(base: number) => number> {
  try {
    const [total, booked, settings] = await Promise.all([
      PropertyModel.countDocuments({ hotel_id: hotelId }),
      PropertyModel.countDocuments({ hotel_id: hotelId, status: 'booked' }),
      loadHotelSystemSettings(hotelId),
    ]);
    const s = (settings ?? {}) as Doc;
    const enabled = s.surge_pricing_enabled === undefined || s.surge_pricing_enabled === null ? true : Boolean(s.surge_pricing_enabled);
    const threshold = s.surge_threshold_percent == null ? 50 : num(s.surge_threshold_percent);
    const markup = s.surge_markup_percent == null ? 20 : num(s.surge_markup_percent);
    const occupancy = total > 0 ? (booked / total) * 100 : 0;
    const surging = total > 0 && enabled && occupancy > threshold && markup > 0;
    return (base) => (surging ? nearest50(nearest50(base) * (1 + markup / 100)) : nearest50(base));
  } catch {
    // ponytail: if room counts or settings can't be read, price without surge (may be under the
    // hotel app's price while it is surging). Fine as a fallback; log if it starts happening.
    return (base) => nearest50(base);
  }
}

export interface HotelStayCharge {
  amount: number;
  billingMode: 'nightly' | 'hourly';
  nights: number;
  stayHours: number | null;
  blockHours: number | null;
  blocks: number | null;
  /** Nightly rate or block price after surge — what one night / one block costs. */
  unitPrice: number;
  window: StayWindow;
}

/** RoomBillingSupport::computeStayCharge for one room and stay window. */
export function computeStayCharge(
  room: Doc,
  category: Doc | null | undefined,
  window: StayWindow,
  surge: (base: number) => number,
): HotelStayCharge {
  if (!(window.end > window.start)) throw new Error('Check-out must be after check-in.');
  if (isHourlyRoom(room)) {
    const { pricePerBlock, blockHours } = hourlyConfig(room, category);
    const block = surge(pricePerBlock);
    const stayHours = Math.ceil((window.end.getTime() - window.start.getTime()) / HOUR_MS);
    const blocks = Math.ceil(stayHours / blockHours);
    const startDay = Date.parse(`${window.checkInDate}T00:00:00Z`);
    const endDay = Date.parse(`${window.checkOutDate}T00:00:00Z`);
    return {
      amount: nearest50(nearest50(block) * blocks),
      billingMode: 'hourly',
      nights: Math.max(1, Math.round((endDay - startDay) / (24 * HOUR_MS))),
      stayHours,
      blockHours,
      blocks,
      unitPrice: block,
      window,
    };
  }
  const nights = Math.round(
    (Date.parse(`${window.checkOutDate}T00:00:00Z`) - Date.parse(`${window.checkInDate}T00:00:00Z`)) / (24 * HOUR_MS),
  );
  if (nights <= 0) throw new Error('Check-out must be after check-in.');
  const nightly = surge(num(room.price_per_night));
  return {
    amount: nearest50(nearest50(nightly) * nights),
    billingMode: 'nightly',
    nights,
    stayHours: null,
    blockHours: null,
    blocks: null,
    unitPrice: nightly,
    window,
  };
}

/** The category doc for a room (hourly block length lives there). */
export async function categoryForRoom(room: Doc): Promise<Doc | null> {
  const id = String(room.category_id ?? '');
  if (!id || !mongoose.isValidObjectId(id)) return null;
  try {
    return ((await RoomCategoryModel.findById(id).lean()) as Doc | null) ?? null;
  } catch {
    return null;
  }
}

/** Price one room for a stay exactly as the hotel app would. */
export async function priceRoomStay(
  room: Doc,
  checkInDate: string,
  checkOutDate: string,
  arrivalTime?: string,
  options: { category?: Doc | null; surge?: (base: number) => number } = {},
): Promise<HotelStayCharge> {
  const category = options.category !== undefined ? options.category : await categoryForRoom(room);
  const surge = options.surge ?? await surgeFor(String(room.hotel_id ?? ''));
  return computeStayCharge(room, category, resolveStayWindow(room, category, checkInDate, checkOutDate, arrivalTime), surge);
}
