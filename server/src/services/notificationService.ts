import mongoose from 'mongoose';
import { BookingModel, ExternalReservationModel, HotelModel, PropertyModel } from '../data/mongoModels';
import { parseMetadata } from '../utils/healBookingMediaUrls';
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

export interface RoomStayDetails {
  roomLabel: string;
  /** Room number only ("1"), '' when unknown. */
  roomNumber: string;
  /** Door code — only when the room's current code was issued to THIS guest (see below). */
  accessPassword: string;
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

/** Guest-facing room label + door code from the assigned rooms document. */
export function formatRoomStayLabel(room: {
  category_name?: unknown;
  display_name?: unknown;
  room_number?: unknown;
} | null | undefined, fallback = ''): string {
  const category = String(room?.category_name ?? '').trim();
  const roomNo = String(room?.room_number ?? '').trim();
  const display = String(room?.display_name ?? '').trim();
  if (category && roomNo && category.toLowerCase() !== roomNo.toLowerCase()) {
    return `${category} · ${roomNo}`;
  }
  if (display) return display;
  if (category) return category;
  if (roomNo) return `Room ${roomNo}`;
  return fallback;
}

async function approvedAccessCode(booking: BookingNotificationTarget): Promise<string> {
  const ref = String(booking.booking_reference ?? '').trim();
  const or: Record<string, string>[] = [{ booking_id: String(booking._id ?? '') }];
  if (ref) or.push({ external_reference: ref });
  try {
    const row = await ExternalReservationModel.findOne({ $or: or }).select('metadata').lean();
    return String(parseMetadata((row as { metadata?: unknown } | null)?.metadata).guest_access_code ?? '').trim();
  } catch {
    return ''; // fall back to the room's code (same-guest rule)
  }
}

export async function resolveRoomStayDetails(
  booking: BookingNotificationTarget,
): Promise<RoomStayDetails> {
  const fallbackLabel = String(booking.propertyName ?? '').trim();
  const roomId = String(booking.room_id ?? booking.propertyId ?? '').trim();
  const none = { roomLabel: fallbackLabel, roomNumber: '', accessPassword: '' };
  if (!roomId) return none;

  try {
    const room = await PropertyModel.findById(roomId)
      .select('category_name display_name room_number current_access_code current_guest_name current_check_in')
      .lean();
    if (!room) return none;
    const typed = room as {
      category_name?: unknown;
      display_name?: unknown;
      room_number?: unknown;
      current_access_code?: unknown;
      current_guest_name?: unknown;
      current_check_in?: unknown;
    };
    // The hotel app sets current_access_code for whoever is checked in to the room NOW.
    // Never email it unless that stay is this booking's (same guest, same check-in date),
    // or a new guest would get the current occupant's door code.
    const sameGuest = String(typed.current_guest_name ?? '').trim().toLowerCase()
      === String(booking.guestName ?? '').trim().toLowerCase();
    const checkInRaw = typed.current_check_in instanceof Date
      ? typed.current_check_in.toISOString()
      : String(typed.current_check_in ?? '');
    const sameStay = checkInRaw.slice(0, 10) !== '' && checkInRaw.slice(0, 10) === String(booking.checkInDate ?? '').slice(0, 10);
    // MADYAWPH saves the website guest's own door code on the reservation when it approves it.
    const accessPassword = await approvedAccessCode(booking)
      || (sameGuest && sameStay ? String(typed.current_access_code ?? '').trim() : '');
    return {
      roomLabel: formatRoomStayLabel(typed, fallbackLabel),
      roomNumber: String(typed.room_number ?? '').trim(),
      accessPassword,
    };
  } catch (error) {
    console.warn('[Notification] Room lookup failed:', error instanceof Error ? error.message : error);
    return none;
  }
}

/** Shared guest email body: welcome + room + access password (hotel-app style). */
export function buildHotelWelcomeBody(input: {
  guestFirstName: string;
  hotelName: string;
  roomLabel: string;
  accessPassword: string;
  bookingReference: string;
  checkIn: string;
  checkOut: string;
  stayLength?: string;
  stayTotal?: number;
  amountPaid?: number | null;
  paidClaim?: number | null;
  paymentProofStored?: boolean;
  closingLine?: string;
}): string {
  const room = input.roomLabel.trim();
  const password = input.accessPassword.trim();
  const lines: Array<string | null> = [
    `Hi ${input.guestFirstName},`,
    '',
    `Welcome to ${input.hotelName}!`,
    '',
    room ? 'YOUR ROOM' : null,
    room || null,
    room ? '' : null,
    password ? 'ROOM ACCESS PASSWORD' : null,
    password || null,
    password ? '' : null,
    `Reference: ${input.bookingReference}`,
    `Check-in: ${input.checkIn}`,
    `Check-out: ${input.checkOut}`,
    input.stayLength ? `Length of stay: ${input.stayLength}` : null,
    input.stayTotal != null && input.stayTotal > 0 ? `Stay total: ${peso(input.stayTotal)}` : null,
    input.amountPaid != null && input.amountPaid > 0 ? `Amount paid: ${peso(input.amountPaid)}` : null,
    input.paymentProofStored && input.paidClaim != null
      ? `Payment screenshot received: ${peso(input.paidClaim)} (we will verify it shortly)`
      : null,
    '',
    input.closingLine
      ?? (password
        ? 'Please use your room access password when you arrive. If you need help, reply to this email or contact the hotel directly.'
        : 'Please check in at the hotel on your arrival date. Your room access password will be provided if it is not listed above.'),
    '',
    `— ${input.hotelName}`,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * Approval email in the hotel's name, laid out like the hotel app's own welcome mail:
 * welcome line, room card (number, reference, dates), access password, sign-off.
 */
export function buildHotelWelcomeHtml(input: {
  hotelName: string;
  guestName: string;
  roomNumber: string;
  roomLabel: string;
  accessPassword: string;
  bookingReference: string;
  checkIn: string;
  checkOut: string;
}): string {
  const hotel = escapeHtml(input.hotelName);
  const roomTitle = escapeHtml(input.roomNumber ? `Room ${input.roomNumber}` : (input.roomLabel || 'Your room'));
  const password = escapeHtml(input.accessPassword);
  const font = "font-family:'Segoe UI',Arial,sans-serif;";
  return `<!doctype html><html><body style="margin:0;background:#f3f5fa;padding:24px;${font}">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;color:#334155;">
  <h1 style="margin:0 0 24px;color:#1e2a78;font-size:26px;">Welcome to ${hotel}!</h1>
  <p style="margin:0 0 12px;font-size:15px;">Hi ${escapeHtml(input.guestName)}, your booking has been approved. Here are your room details${password ? ' and access password' : ''}.</p>
  <div style="background:#eef2fb;border:1px solid #d6def3;border-radius:12px;padding:20px;margin:20px 0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1px;color:#64748b;">YOUR ROOM</p>
    <p style="margin:0 0 10px;font-size:20px;font-weight:700;color:#1e2a78;">${roomTitle}</p>
    <p style="margin:0 0 6px;font-size:13px;">Reference: ${escapeHtml(input.bookingReference)}</p>
    <p style="margin:0;font-size:13px;">Check-in: ${escapeHtml(input.checkIn)} · Check-out: ${escapeHtml(input.checkOut)}</p>
  </div>
  ${password ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1px;color:#64748b;">ROOM ACCESS PASSWORD</p>
  <div style="display:inline-block;background:#1e2a78;color:#ffffff;border-radius:10px;padding:14px 26px;font-size:26px;font-weight:700;letter-spacing:6px;">${password}</div>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b;">Use this password for guest portal access and room services during your stay. Please keep it private. If you need help, visit the front desk.</p>`
    : `<p style="margin:0;font-size:13px;color:#64748b;">Your room access password will be given to you at check-in. If you need help, reply to this email or contact the front desk.</p>`}
  <p style="margin:28px 0 0;font-size:14px;">Warm regards,<br><strong>${hotel}</strong></p>
</div></body></html>`;
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

async function deliverEmail(to: string, subject: string, text: string, from: string, html?: string): Promise<EmailSendResult> {
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
      ...(html ? { html } : {}),
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
  const stay = await resolveRoomStayDetails(booking);
  const ref = booking.booking_reference || String(booking._id || '');
  const checkIn = formatStayDate(booking.checkInDate, 'your selected check-in date');
  const checkOut = formatStayDate(booking.checkOutDate, 'your selected check-out date');
  const stayLength = formatStayLength(booking);
  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const paidClaim = Number(booking.payment_proof_amount_claimed ?? stayTotal);

  const subject = `Welcome to ${hotelName} — your room details`;
  const messageBody = buildHotelWelcomeBody({
    guestFirstName: guestFirstName(booking),
    hotelName,
    roomLabel: stay.roomLabel,
    accessPassword: stay.accessPassword,
    bookingReference: ref,
    checkIn,
    checkOut,
    stayLength: stayLength || undefined,
    stayTotal,
    paidClaim,
    paymentProofStored: Boolean(booking.payment_proof_stored),
  });

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
  const stay = await resolveRoomStayDetails(booking);
  const checkInDate = formatStayDate(booking.checkInDate, 'your check-in date');
  const checkOutDate = formatStayDate(booking.checkOutDate, 'your check-out date');
  const stayLength = formatStayLength(booking);
  const ref = booking.booking_reference || String(booking._id || '');
  const guestContact = booking.guestEmail || booking.guest_phone || '';
  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const amountPaid = Number(booking.amount_paid ?? booking.amountPaid ?? 0)
    || Number(booking.payment_proof_amount_claimed ?? 0)
    || (booking.payment_proof_stored || booking.payment_proof_filename ? stayTotal : 0);

  const subject = `Welcome to ${hotelName}!`;
  const messageHtml = buildHotelWelcomeHtml({
    hotelName,
    guestName: String(booking.guestName ?? 'Guest').trim() || 'Guest',
    roomNumber: stay.roomNumber,
    roomLabel: stay.roomLabel,
    accessPassword: stay.accessPassword,
    bookingReference: ref,
    checkIn: checkInDate,
    checkOut: checkOutDate,
  });
  const messageBody = buildHotelWelcomeBody({
    guestFirstName: guestFirstName(booking),
    hotelName,
    roomLabel: stay.roomLabel,
    accessPassword: stay.accessPassword,
    bookingReference: ref,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    stayLength: stayLength || undefined,
    stayTotal,
    amountPaid,
    closingLine: stay.accessPassword
      ? 'We look forward to welcoming you. Use your room access password when you arrive.'
      : 'We look forward to welcoming you. If you have any questions before your stay, reply to this email or contact us directly.',
  });

  try {
    if (String(booking.guestEmail).toLowerCase() === 'fail@notification.test' || String(booking.guest_phone) === 'FAIL') {
      throw new Error('Simulated delivery failure: Unable to reach guest contact method.');
    }

    if (!booking.guestEmail) {
      throw new Error('Guest email is required to send confirmation.');
    }

    const result = await deliverEmail(booking.guestEmail, subject, messageBody, senderFor(hotelName), messageHtml);
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
      ? ['Because the hotel could not keep your booking, your payment will be refunded in full by the hotel. Reply to this email if you have questions about your refund.', '']
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
      ? ['Because the hotel could not keep your booking, your payment will be refunded in full by the hotel. Reply to this email if you have questions about your refund.', '']
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
