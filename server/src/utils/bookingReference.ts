import mongoose from 'mongoose';

/**
 * Booking numbers: CC-HH-T-YYMMDD-HHMM, e.g. AA-AB-O-261023-1532 — the same format and the
 * same collections as MADYAWPH (app/Services/BookingNumberService.php):
 *   CC  city code   (collection city_codes: one unique 2-letter code per city)
 *   HH  hotel code  (hotels.booking_code: unique 2-letter code per hotel, kept forever)
 *   T   booking type letter (website bookings are O)
 *   YYMMDD-HHMM  creation time in Asia/Manila
 * Every number is claimed in booking_number_claims (unique _id), so two bookings in the same
 * minute never share one: the later one takes the next free minute.
 */

export const BOOKING_TYPE_LETTERS = { walk_in: 'W', online: 'O', phone: 'P', reservation: 'R' } as const;
export type BookingNumberType = keyof typeof BOOKING_TYPE_LETTERS;

/** 1 => AA, 2 => AB … 676 => ZZ. */
export function codeFromSequence(sequence: number): string {
  const n = sequence - 1;
  if (!Number.isInteger(n) || n < 0 || n >= 26 * 26) throw new Error('All 2-letter booking codes are used.');
  return String.fromCharCode(65 + Math.floor(n / 26)) + String.fromCharCode(65 + (n % 26));
}

/** "Butuan City" and "butuan" share one key. */
export function cityKey(city: string): string {
  const key = city.toLowerCase().trim()
    .replace(/^(city|municipality) of\s+/, '')
    .replace(/\s+(city|municipality)$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return key || 'unassigned';
}

/** Date (YYMMDD) and time (HHMM, 24 h, leading zeros kept) of a moment in Asia/Manila. */
export function manilaStamp(moment: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(moment);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return { date: `${get('year')}${get('month')}${get('day')}`, time: `${get('hour')}${get('minute')}` };
}

export function formatBookingNumber(city: string, hotel: string, type: BookingNumberType, moment: Date): string {
  const { date, time } = manilaStamp(moment);
  return `${city}-${hotel}-${BOOKING_TYPE_LETTERS[type]}-${date}-${time}`;
}

type CounterDoc = { seq?: number } | null;

async function nextSequence(db: mongoose.mongo.Db, name: string): Promise<number> {
  const result = await db.collection<{ _id: string; seq: number }>('booking_counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  ) as unknown as CounterDoc | { value?: CounterDoc };
  const doc = result && 'value' in result ? result.value : (result as CounterDoc);
  const seq = Number(doc?.seq);
  if (!Number.isFinite(seq)) throw new Error('booking counter missing');
  return seq;
}

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

async function cityCode(db: mongoose.mongo.Db, city: string): Promise<string> {
  const key = cityKey(city);
  const cities = db.collection<{ _id: string; city: string; code: string }>('city_codes');
  const existing = await cities.findOne({ _id: key });
  if (existing) return existing.code;
  const code = codeFromSequence(await nextSequence(db, 'city_code'));
  try {
    await cities.insertOne({ _id: key, city: city.trim(), code, created_at: new Date() } as never);
    return code;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return (await cities.findOne({ _id: key }))?.code ?? code; // another request registered it first
  }
}

const hotelFilter = (hotelId: string) => ({
  _id: (mongoose.isValidObjectId(hotelId) ? new mongoose.Types.ObjectId(hotelId) : hotelId) as never,
});

async function hotelCityAndCode(db: mongoose.mongo.Db, hotelId: string): Promise<{ city: string; code: string }> {
  const hotels = db.collection('hotels');
  const hotel = await hotels.findOne(hotelFilter(hotelId));
  if (!hotel) return { city: '', code: 'XX' };
  const city = String(hotel.city ?? '');
  const existing = String(hotel.booking_code ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(existing)) return { city, code: existing };

  const code = codeFromSequence(await nextSequence(db, 'hotel_code'));
  const updated = await hotels.updateOne(
    { ...hotelFilter(hotelId), $or: [{ booking_code: { $exists: false } }, { booking_code: null }, { booking_code: '' }] },
    { $set: { booking_code: code } },
  );
  if (updated.modifiedCount > 0) return { city, code };
  const fresh = await hotels.findOne(hotelFilter(hotelId)); // another request assigned it first
  return { city, code: String(fresh?.booking_code ?? code).toUpperCase() };
}

/** Numbers handed out while the database is unavailable (tests, outages). */
const memoryClaims = new Set<string>();

async function claim(db: mongoose.mongo.Db | undefined, number: string, hotelId: string): Promise<boolean> {
  if (!db) {
    if (memoryClaims.has(number)) return false;
    memoryClaims.add(number);
    return true;
  }
  try {
    await db.collection('booking_number_claims').insertOne({ _id: number, hotel_id: hotelId, created_at: new Date() } as never);
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
}

/**
 * Reserve `count` booking numbers for a hotel (one per room type of a booking). Never throws:
 * if the database lookups fail the number uses XX codes, so a booking is still possible.
 */
export async function nextBookingReferences(
  hotelId: string,
  count: number,
  type: BookingNumberType = 'online',
): Promise<string[]> {
  const db = mongoose.connection.db;
  let city = 'XX';
  let hotel = 'XX';
  try {
    if (db) {
      const info = await hotelCityAndCode(db, hotelId);
      hotel = info.code;
      city = await cityCode(db, info.city);
    }
  } catch (error) {
    console.warn('[Bookings] Booking code lookup failed, using XX codes:', error instanceof Error ? error.message : error);
  }

  const numbers: string[] = [];
  let moment = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  while (numbers.length < count) {
    for (let attempt = 0; ; attempt += 1) {
      if (attempt >= 1440) throw new Error('No free booking number found for this hotel.');
      const number = formatBookingNumber(city, hotel, type, moment);
      let claimed: boolean;
      try {
        claimed = await claim(db, number, hotelId);
      } catch {
        claimed = await claim(undefined, number, hotelId); // database trouble: keep the booking possible
      }
      moment = new Date(moment.getTime() + 60_000);
      if (claimed) { numbers.push(number); break; }
    }
  }
  return numbers;
}
