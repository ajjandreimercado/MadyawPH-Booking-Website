/**
 * Watches hotel-app updates on `external_reservations` and syncs website bookings.
 * Requires a replica set (MongoDB Atlas supports this). Disabled when
 * ENABLE_EXTERNAL_RESERVATION_WATCHER=false or in test.
 */

import type { ChangeStream } from 'mongodb';
import { BookingModel, ExternalReservationModel } from '../data/mongoModels';
import { ONLINE_BOOKING_EXTERNAL_SOURCE } from '../utils/externalReservation';
import { applyHotelBookingDecision } from './hotelBookingSync';
import { sendBookingCancelledNotification } from './notificationService';
import { finalizeDepositAfterHotelVerification } from '../utils/syncPaymentProofToHotel';
import { isExternalReservationWatcherEnabled } from '../config/env';

let changeStream: ChangeStream | null = null;
let bookingChangeStream: ChangeStream | null = null;
let starting = false;

function parseMetadataChannel(metadata: unknown): string {
  if (!metadata) return '';
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as { channel?: string; booking_source?: string };
      return String(parsed.channel ?? parsed.booking_source ?? '');
    } catch {
      return '';
    }
  }
  if (typeof metadata === 'object') {
    const obj = metadata as { channel?: string; booking_source?: string };
    return String(obj.channel ?? obj.booking_source ?? '');
  }
  return '';
}

function isWebsiteOnlineBooking(doc: {
  source?: string;
  metadata?: unknown;
  booking_id?: string;
  external_reference?: string;
}): boolean {
  if (String(doc.source ?? '') === ONLINE_BOOKING_EXTERNAL_SOURCE) return true;
  const channel = parseMetadataChannel(doc.metadata).toLowerCase();
  if (channel.includes('website')) return true;
  // Fallback: rows we created always set booking_id + external_reference (BR-…).
  return Boolean(doc.booking_id && doc.external_reference);
}

function parseMetadataFlags(metadata: unknown): { paymentProofVerified: boolean } {
  if (!metadata) return { paymentProofVerified: false };
  let obj: Record<string, unknown> = {};
  if (typeof metadata === 'string') {
    try {
      obj = JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return { paymentProofVerified: false };
    }
  } else if (typeof metadata === 'object') {
    obj = metadata as Record<string, unknown>;
  }
  return { paymentProofVerified: Boolean(obj.payment_proof_verified) };
}

async function handleExternalDoc(doc: {
  status?: string;
  booking_id?: string;
  external_reference?: string;
  source?: string;
  metadata?: unknown;
}) {
  if (!doc) return;
  if (!isWebsiteOnlineBooking(doc)) return;

  const bookingId = doc.booking_id ? String(doc.booking_id) : '';
  const flags = parseMetadataFlags(doc.metadata);
  if (flags.paymentProofVerified && bookingId) {
    try {
      await BookingModel.updateOne(
        { _id: bookingId, payment_proof_stored: true },
        { $set: { payment_proof_verified: true, payment_proof_verified_at: new Date() } },
      );
      await finalizeDepositAfterHotelVerification(bookingId);
      console.log(`[HotelSync] Deposit finalized after hotel verified proof for ${bookingId}`);
    } catch (error) {
      console.error('[HotelSync] Failed to finalize verified deposit:', error);
    }
  }

  if (!doc.status) return;

  const result = await applyHotelBookingDecision({
    bookingId: bookingId || undefined,
    bookingReference: doc.external_reference ? String(doc.external_reference) : undefined,
    status: String(doc.status),
    source: 'change-stream',
  });

  console.log(
    `[HotelSync] change-stream status=${doc.status} ref=${doc.external_reference ?? ''} → ${result.kind}: ${result.message}`,
  );
}

const CANCELLED_STATUSES = ['cancelled', 'canceled'];

/**
 * The hotel app may cancel a confirmed stay on the `bookings` record itself rather than
 * through external_reservations. Email the guest when that happens to a website booking
 * the hotel had confirmed. Guests can only cancel unconfirmed requests, so those never match.
 */
async function handleBookingCancelled(bookingId: unknown) {
  const booking = await BookingModel.findById(bookingId).select('-valid_id_base64 -payment_proof_base64').lean();
  if (!booking || !CANCELLED_STATUSES.includes(String(booking.status ?? '').toLowerCase())) return;
  const wasConfirmed = Boolean(booking.confirmationSentAt) || (booking.confirmationSendStatus ?? 'none') !== 'none';
  if (!wasConfirmed || !booking.guestEmail) return;
  await sendBookingCancelledNotification(booking as never);
}

function startBookingCancellationWatcher() {
  if (bookingChangeStream) return;
  try {
    bookingChangeStream = BookingModel.watch([
      {
        $match: {
          operationType: 'update',
          'updateDescription.updatedFields.status': { $in: CANCELLED_STATUSES },
        },
      },
    ]);
    bookingChangeStream.on('change', (change) => {
      const id = (change as { documentKey?: { _id?: unknown } }).documentKey?._id;
      if (id == null) return;
      void handleBookingCancelled(id).catch((error) => {
        console.error('[HotelSync] Failed to handle booking cancellation:', error);
      });
    });
    bookingChangeStream.on('error', (error) => {
      console.error('[HotelSync] Booking change stream error (will not crash process):', error);
      bookingChangeStream = null;
    });
    console.log('[HotelSync] Watching bookings for hotel-side cancellations…');
  } catch (error) {
    bookingChangeStream = null;
    console.error('[HotelSync] Could not watch bookings for cancellations:', error instanceof Error ? error.message : error);
  }
}

export async function startExternalReservationWatcher(): Promise<void> {
  if (!isExternalReservationWatcherEnabled()) {
    console.log('[HotelSync] external_reservations change stream watcher is disabled.');
    return;
  }
  startBookingCancellationWatcher();
  if (changeStream || starting) return;
  starting = true;

  try {
    changeStream = ExternalReservationModel.watch(
      [
        {
          $match: {
            operationType: { $in: ['insert', 'update', 'replace'] },
          },
        },
      ],
      { fullDocument: 'updateLookup' },
    );

    changeStream.on('change', (change) => {
      const fullDocument = (change as { fullDocument?: Record<string, unknown> }).fullDocument;
      if (!fullDocument) return;
      void handleExternalDoc(fullDocument as never).catch((error) => {
        console.error('[HotelSync] Failed to apply change-stream event:', error);
      });
    });

    changeStream.on('error', (error) => {
      console.error('[HotelSync] Change stream error (will not crash process):', error);
      // Drop the handle so a future restart attempt can recreate it.
      changeStream = null;
      starting = false;
    });

    console.log('[HotelSync] Watching external_reservations for hotel approval/rejection…');
  } catch (error) {
    changeStream = null;
    console.error(
      '[HotelSync] Could not start change stream (Atlas replica set required). Webhook endpoint still works.',
      error instanceof Error ? error.message : error,
    );
  } finally {
    starting = false;
  }
}

export async function stopExternalReservationWatcher(): Promise<void> {
  if (bookingChangeStream) {
    await bookingChangeStream.close().catch(() => undefined);
    bookingChangeStream = null;
  }
  if (!changeStream) return;
  try {
    await changeStream.close();
  } catch (error) {
    console.warn('[HotelSync] Error closing change stream:', error);
  } finally {
    changeStream = null;
    starting = false;
  }
}
