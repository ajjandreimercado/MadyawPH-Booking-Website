/**
 * Watches hotel-app updates on `external_reservations` and syncs website bookings.
 * Requires a replica set (MongoDB Atlas supports this). Disabled when
 * ENABLE_EXTERNAL_RESERVATION_WATCHER=false or in test.
 */

import type { ChangeStream } from 'mongodb';
import { ExternalReservationModel } from '../data/mongoModels';
import { ONLINE_BOOKING_EXTERNAL_SOURCE } from '../utils/externalReservation';
import { applyHotelBookingDecision } from './hotelBookingSync';
import { isExternalReservationWatcherEnabled } from '../config/env';

let changeStream: ChangeStream | null = null;
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

async function handleExternalDoc(doc: {
  status?: string;
  booking_id?: string;
  external_reference?: string;
  source?: string;
  metadata?: unknown;
}) {
  if (!doc?.status) return;
  if (!isWebsiteOnlineBooking(doc)) return;

  const result = await applyHotelBookingDecision({
    bookingId: doc.booking_id ? String(doc.booking_id) : undefined,
    bookingReference: doc.external_reference ? String(doc.external_reference) : undefined,
    status: String(doc.status),
    source: 'change-stream',
  });

  console.log(
    `[HotelSync] change-stream status=${doc.status} ref=${doc.external_reference ?? ''} → ${result.kind}: ${result.message}`,
  );
}

export async function startExternalReservationWatcher(): Promise<void> {
  if (!isExternalReservationWatcherEnabled()) {
    console.log('[HotelSync] external_reservations change stream watcher is disabled.');
    return;
  }
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
