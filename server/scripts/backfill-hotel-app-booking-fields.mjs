/**
 * Non-destructive backfill for website bookings missing hotel-app fields.
 *
 * Adds only missing / corrects website-only booking_type for hotel UI:
 *   guest_name, guest_email, check_in_date, check_out_date, created_at,
 *   booking_type=online, booking_source, payment_method, billing_mode, summary_only
 *
 * Does NOT delete documents or overwrite existing non-empty hotel fields.
 *
 * Usage:
 *   node scripts/backfill-hotel-app-booking-fields.mjs           # dry-run
 *   CONFIRM_BACKFILL=YES node scripts/backfill-hotel-app-booking-fields.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const APPLY = process.env.CONFIRM_BACKFILL === 'YES';

if (!MONGODB_URI) throw new Error('MONGODB_URI is required.');

function toStayDate(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? '').trim());
  if (!match) {
    const fallback = new Date(dateStr);
    if (Number.isNaN(fallback.getTime())) return null;
    return fallback;
  }
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
}

function toYmd(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Interpret stored Date in Manila so we recover the calendar stay day
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function _idStr(id) {
  return id?.toString?.() ?? String(id);
}

async function main() {
  await mongoose.connect(MONGODB_URI, DB_NAME ? { dbName: DB_NAME } : undefined);
  const bookings = mongoose.connection.collection('bookings');

  // Website-created docs that the hotel app cannot read correctly
  const filter = {
    $or: [
      { source: 'web', booking_type: 'request_to_book' },
      { source: 'web', check_in_date: { $exists: false } },
      { source: 'web', guest_name: { $exists: false } },
      { source: 'web', created_at: { $exists: false } },
      { source: 'web', summary_only: { $exists: false } },
      { source: 'web', summary_only: { $nin: [0, 1, true, false] } },
      { summary_only: { $exists: false } },
      { summary_only: { $nin: [0, 1, true, false] } },
    ],
  };

  const cursor = bookings.find(filter);
  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const set = {};

    const guestName = doc.guest_name || doc.guestName;
    const guestEmail = doc.guest_email || doc.guestEmail;
    if (!doc.guest_name && guestName) set.guest_name = String(guestName);
    if ((doc.guest_email == null || doc.guest_email === '') && guestEmail) {
      set.guest_email = String(guestEmail);
    }

    if (!doc.check_in_date) {
      const ymd = toYmd(doc.checkInDate);
      const stay = ymd ? toStayDate(ymd) : null;
      if (stay) set.check_in_date = stay;
    }
    if (!doc.check_out_date) {
      const ymd = toYmd(doc.checkOutDate);
      const stay = ymd ? toStayDate(ymd) : null;
      if (stay) set.check_out_date = stay;
    }

    if (!doc.created_at) {
      const created = doc.createdAt || doc.requestedAt;
      if (created) set.created_at = new Date(created);
    }
    if (!doc.updated_at) {
      const updatedAt = doc.updatedAt || doc.createdAt || doc.requestedAt;
      if (updatedAt) set.updated_at = new Date(updatedAt);
    }

    // Hotel UI treats non-"online" website types as Local
    if (doc.booking_type === 'request_to_book' || !doc.booking_type) {
      set.booking_type = 'online';
    }
    if (!doc.booking_source) {
      set.booking_source = 'website-customer';
    }
    if (!doc.payment_method && doc.paymentMethod) {
      set.payment_method = String(doc.paymentMethod);
    }
    if (!doc.billing_mode) {
      set.billing_mode = 'nightly';
    }
    if (doc.summary_only !== 0 && doc.summary_only !== 1) {
      set.summary_only = doc.summary_only === true || doc.summary_only === '1' ? 1 : 0;
    }

    if (Object.keys(set).length === 0) continue;
    wouldUpdate += 1;

    if (APPLY) {
      await bookings.updateOne({ _id: doc._id }, { $set: set });
      updated += 1;
    } else if (wouldUpdate <= 8) {
      console.log(`[dry-run] ${doc.booking_reference || _idStr(doc._id)} →`, set);
    }
  }

  console.log(
    APPLY
      ? `[backfill] Applied. scanned=${scanned} updated=${updated}`
      : `[backfill] Dry-run only. scanned=${scanned} wouldUpdate=${wouldUpdate}. Set CONFIRM_BACKFILL=YES to apply.`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
