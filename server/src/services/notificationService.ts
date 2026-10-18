import mongoose from 'mongoose';
import { BookingModel, HotelModel } from '../data/mongoModels';
import { CLIENT_ORIGINS, getEmailFrom, getResendApiKey } from '../config/env';
import { signReceiptToken } from '../utils/receiptToken';

export interface BookingNotificationTarget {
  _id?: unknown;
  hotel_id?: unknown;
  hotel_name?: unknown;
  hotelName?: unknown;
  propertyId?: unknown;
  room_id?: unknown;
  booking_reference?: string;
  propertyName?: string;
  guestName?: string;
  guestEmail?: string;
  guest_phone?: string;
  checkInDate?: string;
  checkOutDate?: string;
  nights?: number;
  totalPrice?: number;
  total_amount?: number;
  deposit_amount?: number;
  amount_paid?: number;
  amountPaid?: number;
  payment_proof_amount_claimed?: number;
  payment_proof_stored?: boolean;
  payment_proof_filename?: string;
  payment_transaction_ref?: string;
  online_payment_mode?: string;
  deposit_percent?: number;
  confirmationSendStatus?: string;
  confirmationSentAt?: Date | string | null;
  confirmationSendError?: string;
  requestSendStatus?: string;
  requestSentAt?: Date | string | null;
  declineSendStatus?: string;
  declineSentAt?: Date | string | null;
  save?: () => Promise<unknown>;
}

/** Secure pay-deposit link for the guest (receipt token, 7-day expiry). */
export function buildPayDepositUrl(booking: BookingNotificationTarget): string {
  const origin = frontendOrigin();
  const bookingId = String(booking._id ?? '');
  const email = String(booking.guestEmail ?? '').trim().toLowerCase();
  if (!bookingId || !email) return `${origin}/search`;
  const token = signReceiptToken(bookingId, email);
  const params = new URLSearchParams({
    token,
    email,
    pay: '1',
  });
  return `${origin}/booking/confirm/${encodeURIComponent(bookingId)}?${params.toString()}`;
}

interface EmailSendResult {
  delivered: boolean;
  provider: 'resend' | 'console';
  error?: string;
}

function frontendOrigin(): string {
  return CLIENT_ORIGINS[0] ?? 'http://localhost:3000';
}

function guestFirstName(booking: BookingNotificationTarget): string {
  const name = String(booking.guestName ?? 'Guest').trim();
  return name.split(/\s+/)[0] || 'Guest';
}

/** yyyy-MM-dd → "Oct 18, 2026" (month-day-year); other input is returned unchanged. */
export function formatStayDate(value: string | undefined, fallback: string): string {
  const raw = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return value || fallback;
  return new Date(`${raw}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** "1 night" / "3 nights" — website bookings are always by the night. */
export function formatStayLength(booking: BookingNotificationTarget): string {
  let nights = Number(booking.nights ?? 0);
  if (!(nights > 0) && booking.checkInDate && booking.checkOutDate) {
    nights = Math.round(
      (Date.parse(String(booking.checkOutDate).slice(0, 10)) - Date.parse(String(booking.checkInDate).slice(0, 10)))
      / 86_400_000,
    );
  }
  if (!(nights > 0)) return '';
  return `${nights} night${nights === 1 ? '' : 's'}`;
}

function peso(amount: number): string {
  return `₱${Math.max(0, Math.round(amount)).toLocaleString('en-US')}`;
}

/** Emails go out in the hotel's name — never brand the guest email as Madyaw. */
async function resolveHotelName(booking: BookingNotificationTarget): Promise<string> {
  const embedded = String(booking.hotel_name ?? booking.hotelName ?? '').trim();
  if (embedded) return embedded;

  const hotelId = booking.hotel_id ? String(booking.hotel_id) : '';
  if (hotelId && mongoose.isValidObjectId(hotelId)) {
    try {
      const hotel = await HotelModel.findById(hotelId).select('name').lean();
      const name = String((hotel as { name?: unknown } | null)?.name ?? '').trim();
      if (name) return name;
    } catch (error) {
      console.warn('[Notification] Hotel name lookup failed:', error instanceof Error ? error.message : error);
    }
  }
  const roomLabel = String(booking.propertyName ?? '').trim();
  return roomLabel || 'your hotel';
}

/** Keep the verified sending address from EMAIL_FROM, but show the hotel's name. */
export function senderFor(hotelName: string): string {
  const configured = getEmailFrom();
  const address = configured.match(/<([^>]+)>/)?.[1] ?? configured;
  const displayName = hotelName.replace(/["<>\r\n]/g, '').trim() || 'Madyaw Bookings';
  return `${displayName} <${address}>`;
}

/** Link guests can use to start a new booking after a decline. */
export function buildRebookUrl(booking: BookingNotificationTarget): string {
  const origin = frontendOrigin();
  const hotelId = booking.hotel_id ? String(booking.hotel_id) : '';
  if (hotelId) {
    return `${origin}/hotels/${encodeURIComponent(hotelId)}`;
  }
  const propertyId = String(booking.propertyId ?? booking.room_id ?? '');
  if (propertyId) {
    const params = new URLSearchParams();
    if (booking.checkInDate) params.set('checkIn', String(booking.checkInDate).slice(0, 10));
    if (booking.checkOutDate) params.set('checkOut', String(booking.checkOutDate).slice(0, 10));
    const qs = params.toString();
    return `${origin}/booking/${encodeURIComponent(propertyId)}${qs ? `?${qs}` : ''}`;
  }
  return `${origin}/search`;
}

/**
 * Run guest email work off the request path so booking/confirm UX is not blocked
 * waiting on Resend.
 */
export function queueGuestNotification(label: string, task: () => Promise<unknown>): void {
  void task().catch((error) => {
    console.error(`[Notification] ${label} failed:`, error);
  });
}

async function deliverEmail(to: string, subject: string, text: string, from: string): Promise<EmailSendResult> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.log(`\n======================================================`);
    console.log(`[NOTIFICATION CONSOLE FALLBACK] From: ${from} To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Message:\n${text}`);
    console.log(`======================================================\n`);
    return { delivered: false, provider: 'console', error: 'RESEND_API_KEY is not configured.' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    console.error(`[Notification] Resend failed (${response.status}): ${bodyText.slice(0, 500)}`);
    return {
      delivered: false,
      provider: 'resend',
      error: `Email delivery failed (${response.status}).`,
    };
  }

  return { delivered: true, provider: 'resend' };
}

/**
 * Prefer a targeted $set so we never rewrite multi-MB valid_id_base64 on email status updates.
 */
async function persistSendState(
  booking: BookingNotificationTarget,
  fields: Record<string, unknown>,
): Promise<void> {
  Object.assign(booking, fields);
  const id = booking._id;
  if (id != null) {
    await BookingModel.updateOne({ _id: id }, { $set: fields });
    return;
  }
  if (typeof booking.save === 'function') {
    await booking.save();
  }
}

/**
 * Email the guest right after they complete booking — welcome from the hotel
 * (no reservation-request copy, no payment link).
 */
export async function sendBookingRequestReceivedNotification(
  booking: BookingNotificationTarget,
): Promise<boolean> {
  if (booking.requestSendStatus === 'sent' || booking.requestSentAt) {
    return true;
  }

  const email = String(booking.guestEmail ?? '').trim();
  if (!email) return false;

  const hotelName = await resolveHotelName(booking);
  const room = booking.propertyName ? ` (${booking.propertyName})` : '';
  const ref = booking.booking_reference || String(booking._id || '');
  const checkIn = formatStayDate(booking.checkInDate, 'your selected check-in date');
  const checkOut = formatStayDate(booking.checkOutDate, 'your selected check-out date');
  const stayLength = formatStayLength(booking);
  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const paidClaim = Number(booking.payment_proof_amount_claimed ?? stayTotal);

  const subject = `Welcome to ${hotelName}`;
  const messageBody = [
    `Hi ${guestFirstName(booking)},`,
    '',
    `Welcome to ${hotelName}!`,
    '',
    `Thank you for completing your booking${room}. We look forward to hosting you.`,
    '',
    `Reference: ${ref}`,
    `Check-in: ${checkIn}`,
    `Check-out: ${checkOut}`,
    ...(stayLength ? [`Length of stay: ${stayLength}`] : []),
    `Stay total: ${peso(stayTotal)}`,
    booking.payment_proof_stored
      ? `Payment received: ${peso(paidClaim)} (we will verify your screenshot shortly)`
      : null,
    '',
    'You will receive another email from us once your stay is confirmed.',
    '',
    `— ${hotelName}`,
  ].filter((line): line is string => line !== null).join('\n');

  try {
    const result = await deliverEmail(email, subject, messageBody, senderFor(hotelName));
    if (!result.delivered) {
      await persistSendState(booking, {
        requestSendStatus: 'failed',
      });
      console.warn(`[Notification] Welcome email not delivered: ${result.error}`);
      return false;
    }
    await persistSendState(booking, {
      requestSendStatus: 'sent',
      requestSentAt: new Date(),
    });
    console.log(`[Notification] Welcome email sent to ${email} as ${hotelName}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delivery failure';
    console.error(`[Notification] Welcome email failed: ${message}`);
    await persistSendState(booking, { requestSendStatus: 'failed' });
    return false;
  }
}

/**
 * Email the guest when the hotel confirms the stay.
 * Guests already pay by QR when they book — no payment-link email.
 */
export async function sendBookingConfirmationNotification(booking: BookingNotificationTarget): Promise<boolean> {
  if (booking.confirmationSendStatus === 'sent' || booking.confirmationSentAt) {
    console.log(`[Notification] Confirmation already sent for booking ${booking._id || booking.booking_reference}. Skipping duplicate send.`);
    return true;
  }

  const hotelName = await resolveHotelName(booking);
  const room = booking.propertyName ? ` (${booking.propertyName})` : '';
  const checkInDate = formatStayDate(booking.checkInDate, 'your check-in date');
  const checkOutDate = formatStayDate(booking.checkOutDate, 'your check-out date');
  const stayLength = formatStayLength(booking);
  const ref = booking.booking_reference || String(booking._id || '');
  const guestContact = booking.guestEmail || booking.guest_phone || '';
  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const amountPaid = Number(booking.amount_paid ?? booking.amountPaid ?? 0)
    || Number(booking.payment_proof_amount_claimed ?? 0)
    || (booking.payment_proof_stored || booking.payment_proof_filename ? stayTotal : 0);

  const stayLines = [
    `Reference: ${ref}`,
    `Check-in: ${checkInDate}`,
    `Check-out: ${checkOutDate}`,
    ...(stayLength ? [`Length of stay: ${stayLength}`] : []),
    `Stay total: ${peso(stayTotal)}`,
    `Amount paid: ${peso(amountPaid)}`,
  ];

  const subject = `Welcome to ${hotelName} — your reservation is confirmed`;
  const messageBody = [
    `Hi ${guestFirstName(booking)},`,
    '',
    `Welcome to ${hotelName}! Your reservation${room} is confirmed.`,
    '',
    ...stayLines,
    '',
    'We look forward to welcoming you. If you have any questions before your stay, reply to this email or contact us directly.',
    '',
    `— ${hotelName}`,
  ].join('\n');

  try {
    if (String(booking.guestEmail).toLowerCase() === 'fail@notification.test' || String(booking.guest_phone) === 'FAIL') {
      throw new Error('Simulated delivery failure: Unable to reach guest contact method.');
    }

    if (!booking.guestEmail) {
      throw new Error('Guest email is required to send confirmation.');
    }

    const result = await deliverEmail(booking.guestEmail, subject, messageBody, senderFor(hotelName));
    const sentTimestamp = new Date();

    if (!result.delivered) {
      await persistSendState(booking, {
        confirmationSendStatus: 'failed',
        confirmationSendError: result.error || 'Email provider unavailable.',
      });
      console.warn(`[Notification] Not delivered via ${result.provider}: ${result.error}`);
      return false;
    }

    await persistSendState(booking, {
      confirmationSendStatus: 'sent',
      confirmationSentAt: sentTimestamp,
      confirmationSendError: '',
    });

    console.log(`[Notification Success] Provider=${result.provider} To=${guestContact} At=${sentTimestamp.toISOString()}`);
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown delivery failure';
    console.error(`[Notification Failure] Failed to send confirmation message to ${guestContact}: ${errorMessage}`);
    await persistSendState(booking, {
      confirmationSendStatus: 'failed',
      confirmationSendError: errorMessage,
    });
    return false;
  }
}

/**
 * Email the guest when the hotel cancels a reservation it had already confirmed.
 * Safe to call from several sync paths: the first caller claims the send atomically.
 */
export async function sendBookingCancelledNotification(booking: BookingNotificationTarget): Promise<boolean> {
  const email = String(booking.guestEmail ?? '').trim();
  if (!email || booking._id == null) return false;

  const claim = await BookingModel.updateOne(
    { _id: booking._id, cancelSendStatus: { $nin: ['sending', 'sent'] } },
    { $set: { cancelSendStatus: 'sending' } },
  );
  if (claim.modifiedCount !== 1) return true; // already sent or being sent

  const hotelName = await resolveHotelName(booking);
  const room = booking.propertyName ? ` (${booking.propertyName})` : '';
  const ref = booking.booking_reference || String(booking._id || '');
  const stayLength = formatStayLength(booking);
  const amountPaid = Number(booking.amount_paid ?? booking.amountPaid ?? 0);

  const subject = `Your reservation at ${hotelName} has been cancelled`;
  const messageBody = [
    `Hi ${guestFirstName(booking)},`,
    '',
    `We're sorry — your reservation at ${hotelName}${room} has been cancelled.`,
    '',
    `Reference: ${ref}`,
    `Check-in: ${formatStayDate(booking.checkInDate, 'your check-in date')}`,
    `Check-out: ${formatStayDate(booking.checkOutDate, 'your check-out date')}`,
    ...(stayLength ? [`Length of stay: ${stayLength}`] : []),
    `Stay total: ${peso(Number(booking.totalPrice ?? booking.total_amount ?? 0))}`,
    `Amount paid: ${peso(amountPaid)}`,
    '',
    ...(amountPaid > 0 || booking.payment_proof_stored || booking.payment_proof_filename
      ? ['If you already made a payment, please reply to this email or contact us directly about it.', '']
      : []),
    'You can choose new dates and book again here:',
    buildRebookUrl(booking),
    '',
    `— ${hotelName}`,
  ].join('\n');

  try {
    const result = await deliverEmail(email, subject, messageBody, senderFor(hotelName));
    if (!result.delivered) {
      await persistSendState(booking, { cancelSendStatus: 'failed' });
      console.warn(`[Notification] Cancellation email not delivered: ${result.error}`);
      return false;
    }
    await persistSendState(booking, { cancelSendStatus: 'sent', cancelSentAt: new Date() });
    console.log(`[Notification] Cancellation email sent to ${email}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delivery failure';
    console.error(`[Notification] Cancellation email failed: ${message}`);
    await persistSendState(booking, { cancelSendStatus: 'failed' });
    return false;
  }
}

/**
 * Email the guest when the hotel declines / cannot accommodate the request.
 * Includes a link to book again at the same hotel.
 */
export async function sendBookingDeclinedNotification(booking: BookingNotificationTarget): Promise<boolean> {
  if (booking.declineSendStatus === 'sent' || booking.declineSentAt) {
    return true;
  }

  const email = String(booking.guestEmail ?? '').trim();
  if (!email) return false;

  const hotelName = await resolveHotelName(booking);
  const ref = booking.booking_reference || String(booking._id || '');
  const rebookUrl = buildRebookUrl(booking);

  const subject = 'Update on your reservation request';
  const messageBody = [
    `Hi ${guestFirstName(booking)},`,
    '',
    `Thank you for your interest in ${hotelName}. Unfortunately, your reservation request could not be confirmed for the dates you selected.`,
    '',
    `Reference: ${ref}`,
    '',
    ...(booking.payment_proof_stored || booking.payment_proof_filename
      ? ['If you already paid, please reply to this email or contact us directly about your refund.', '']
      : []),
    'You can choose new dates and submit another request here:',
    rebookUrl,
    '',
    'We hope to welcome you on another stay.',
    '',
    `— ${hotelName}`,
  ].join('\n');

  try {
    const result = await deliverEmail(email, subject, messageBody, senderFor(hotelName));
    if (!result.delivered) {
      await persistSendState(booking, { declineSendStatus: 'failed' });
      console.warn(`[Notification] Decline email not delivered: ${result.error}`);
      return false;
    }
    await persistSendState(booking, {
      declineSendStatus: 'sent',
      declineSentAt: new Date(),
    });
    console.log(`[Notification] Decline email sent to ${email}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delivery failure';
    console.error(`[Notification] Decline email failed: ${message}`);
    await persistSendState(booking, { declineSendStatus: 'failed' });
    return false;
  }
}
