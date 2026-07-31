/**
 * Non-destructive: create missing external_reservations rows for website bookings
 * so they appear in the hotel app Online Bookings queue (pending_approval).
 *
 *   node scripts/backfill-online-bookings-queue.mjs
 *   CONFIRM_BACKFILL=YES node scripts/backfill-online-bookings-queue.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.env.CONFIRM_BACKFILL === 'YES';
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI required');

function toStayDate(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? '').trim());
  if (match) return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toYmd(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

await mongoose.connect(process.env.MONGODB_URI, process.env.DB_NAME ? { dbName: process.env.DB_NAME } : undefined);
const bookings = mongoose.connection.collection('bookings');
const external = mongoose.connection.collection('external_reservations');

const candidates = await bookings.find({
  source: 'web',
  booking_type: 'online',
  status: { $in: ['pending', 'requested', 'reserved', 'accepted'] },
}).toArray();

let wouldCreate = 0;
let created = 0;

for (const b of candidates) {
  const existing = await external.findOne({
    $or: [
      { booking_id: String(b._id) },
      { external_reference: b.booking_reference },
    ],
  });
  if (existing) continue;

  const checkIn = b.check_in_date || toStayDate(toYmd(b.checkInDate));
  const checkOut = b.check_out_date || toStayDate(toYmd(b.checkOutDate));
  if (!checkIn || !checkOut) {
    console.log('skip missing dates', b.booking_reference);
    continue;
  }

  const now = new Date();
  const metadata = JSON.stringify({
    channel: 'website',
    booking_source: 'website-customer',
    booking_reference: b.booking_reference,
    payment_method: b.payment_method || b.paymentMethod || '',
    estimated_total: Number(b.total_amount ?? b.totalPrice ?? 0),
    billing_mode: b.billing_mode || 'nightly',
    nights: b.nights ?? 1,
    rooms: 1,
    adults: b.adults ?? 1,
    children: b.children ?? 0,
  });

  const doc = {
    hotel_id: String(b.hotel_id ?? ''),
    source: 'app-customer',
    external_reference: String(b.booking_reference),
    guest_name: String(b.guest_name || b.guestName || ''),
    guest_email: String(b.guest_email || b.guestEmail || ''),
    guest_phone: String(b.guest_phone || ''),
    check_in_date: checkIn instanceof Date ? checkIn : new Date(checkIn),
    check_out_date: checkOut instanceof Date ? checkOut : new Date(checkOut),
    assigned_room_id: String(b.room_id ?? b.propertyId ?? ''),
    booking_id: String(b._id),
    status: 'pending_approval',
    metadata,
    created_at: b.created_at ? new Date(b.created_at) : (b.createdAt ? new Date(b.createdAt) : now),
    updated_at: now,
  };

  wouldCreate += 1;
  if (!APPLY) {
    if (wouldCreate <= 8) console.log('[dry-run]', doc.external_reference, doc.guest_name, doc.status);
    continue;
  }
  await external.insertOne(doc);
  created += 1;
}

console.log(
  APPLY
    ? `[backfill-online] Applied. candidates=${candidates.length} created=${created}`
    : `[backfill-online] Dry-run. candidates=${candidates.length} wouldCreate=${wouldCreate}. Set CONFIRM_BACKFILL=YES to apply.`,
);

await mongoose.disconnect();
