/**
 * Backfill guest_id_url / payment_proof_url token links on website bookings
 * so MADYAWPH can open Valid ID + payment screenshots.
 */

import { BookingModel, BookingPaymentProofModel, BookingValidIdModel, ExternalReservationModel } from '../data/mongoModels';
import { bookingFileUrl, newBookingFileToken } from './bookingFileAccess';

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

export async function healBookingMediaUrls(): Promise<{ healed: number }> {
  const bookings = await BookingModel.find({
    source: 'web',
    $or: [
      { valid_id_stored: true },
      { payment_proof_stored: true },
      { payment_proof_filename: { $exists: true, $nin: [null, ''] } },
    ],
  }).select('_id booking_reference hotel_id valid_id_stored payment_proof_stored guest_id_url payment_proof_url').lean();

  let healed = 0;
  for (const booking of bookings) {
    const bookingId = String(booking._id);
    const ref = String(booking.booking_reference ?? '');
    let guestIdUrl = typeof booking.guest_id_url === 'string' ? booking.guest_id_url : '';
    let paymentProofUrl = typeof booking.payment_proof_url === 'string' ? booking.payment_proof_url : '';

    const validDoc = await BookingValidIdModel.findOne({ booking_id: bookingId });
    if (validDoc?.base64) {
      const token = String(validDoc.access_token || newBookingFileToken());
      guestIdUrl = bookingFileUrl(bookingId, 'valid-id', token);
      await BookingValidIdModel.updateOne(
        { _id: validDoc._id },
        { $set: { access_token: token } },
      );
    }

    const proofDoc = await BookingPaymentProofModel.findOne({ booking_id: bookingId });
    const proofBase64 = proofDoc?.base64 || validDoc?.payment_proof_base64;
    if (proofBase64) {
      const token = String(
        proofDoc?.access_token
        || validDoc?.payment_proof_access_token
        || newBookingFileToken(),
      );
      paymentProofUrl = bookingFileUrl(bookingId, 'payment-proof', token);
      if (proofDoc) {
        await BookingPaymentProofModel.updateOne(
          { _id: proofDoc._id },
          { $set: { access_token: token, payment_proof_url: paymentProofUrl } },
        );
      }
      await BookingValidIdModel.updateOne(
        { booking_id: bookingId },
        {
          $set: {
            payment_proof_access_token: token,
            payment_proof_url: paymentProofUrl,
            payment_proof_stored: true,
            ...(proofDoc ? {} : {
              payment_proof_base64: proofBase64,
              payment_proof_mime: validDoc?.payment_proof_mime || 'image/jpeg',
            }),
          },
        },
      );
    }

    // Skip when nothing to write.
    if (!guestIdUrl && !paymentProofUrl) continue;

    const guestToken = guestIdUrl.includes('token=')
      ? new URL(guestIdUrl).searchParams.get('token') || ''
      : '';
    const proofToken = paymentProofUrl.includes('token=')
      ? new URL(paymentProofUrl).searchParams.get('token') || ''
      : '';

    await BookingModel.updateOne(
      { _id: booking._id },
      {
        $set: {
          ...(guestIdUrl ? { guest_id_url: guestIdUrl } : {}),
          ...(guestToken ? { guest_id_access_token: guestToken } : {}),
          ...(paymentProofUrl ? { payment_proof_url: paymentProofUrl } : {}),
          ...(proofToken ? { payment_proof_access_token: proofToken } : {}),
        },
      },
    );

    const externalRows = await ExternalReservationModel.find({
      $or: [{ booking_id: bookingId }, { external_reference: ref }],
    });
    for (const row of externalRows) {
      const meta = parseMetadata(row.metadata);
      const nextMeta = {
        ...meta,
        ...(guestIdUrl ? { guest_id_url: guestIdUrl } : {}),
        ...(paymentProofUrl
          ? {
            payment_proof_url: paymentProofUrl,
            payment_proof_uploaded: true,
            payment_proof_collection: 'booking_payment_proofs',
          }
          : {}),
      };
      row.set({
        metadata: JSON.stringify(nextMeta),
        ...(guestIdUrl ? { guest_id_url: guestIdUrl } : {}),
        ...(paymentProofUrl ? { payment_proof_url: paymentProofUrl } : {}),
        updated_at: new Date(),
      });
      await row.save();
    }

    healed += 1;
    console.log(`[MediaHeal] ${ref || bookingId}: id=${Boolean(guestIdUrl)} proof=${Boolean(paymentProofUrl)}`);
  }

  return { healed };
}
