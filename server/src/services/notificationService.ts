import { BookingModel } from '../data/mongoModels';
import { CLIENT_ORIGINS, getEmailFrom, getResendApiKey } from '../config/env';
import { signReceiptToken } from '../utils/receiptToken';
import { computeOnlinePaymentDue, resolveOnlinePaymentModeFromBooking } from '../utils/halfPayment';

export interface BookingNotificationTarget {
  _id?: unknown;
  hotel_id?: unknown;
  propertyId?: unknown;
  room_id?: unknown;
  booking_reference?: string;
  propertyName?: string;
  guestName?: string;
  guestEmail?: string;
  guest_phone?: string;
  checkInDate?: string;
  checkOutDate?: string;
  totalPrice?: number;
  total_amount?: number;
  deposit_amount?: number;
  amount_paid?: number;
  amountPaid?: number;
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

async function deliverEmail(to: string, subject: string, text: string): Promise<EmailSendResult> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.log(`\n======================================================`);
    console.log(`[NOTIFICATION CONSOLE FALLBACK] To: ${to}`);
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
      from: getEmailFrom(),
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
 * Email the guest right after they submit a reservation request.
 */
export async function sendBookingRequestReceivedNotification(
  booking: BookingNotificationTarget,
): Promise<boolean> {
  if (booking.requestSendStatus === 'sent' || booking.requestSentAt) {
    return true;
  }

  const email = String(booking.guestEmail ?? '').trim();
  if (!email) return false;

  const propertyName = booking.propertyName || 'our hotel';
  const ref = booking.booking_reference || String(booking._id || '');
  const checkIn = booking.checkInDate || 'your selected check-in date';
  const checkOut = booking.checkOutDate || 'your selected check-out date';

  const subject = 'We received your reservation request';
  const messageBody = [
    `Hi ${guestFirstName(booking)},`,
    '',
    `Thank you for booking with Madyaw. We have received your reservation request for ${propertyName}.`,
    '',
    `Reference: ${ref}`,
    `Check-in: ${checkIn}`,
    `Check-out: ${checkOut}`,
    '',
    'The hotel is reviewing your request. You will receive another email when they confirm — then you can pay the deposit online.',
    '',
    'No payment is needed until the hotel confirms your reservation.',
    '',
    '— Madyaw Bookings',
  ].join('\n');

  try {
    const result = await deliverEmail(email, subject, messageBody);
    if (!result.delivered) {
      await persistSendState(booking, {
        requestSendStatus: 'failed',
      });
      console.warn(`[Notification] Request email not delivered: ${result.error}`);
      return false;
    }
    await persistSendState(booking, {
      requestSendStatus: 'sent',
      requestSentAt: new Date(),
    });
    console.log(`[Notification] Request received email sent to ${email}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delivery failure';
    console.error(`[Notification] Request email failed: ${message}`);
    await persistSendState(booking, { requestSendStatus: 'failed' });
    return false;
  }
}

/**
 * Sends a confirmation message to the guest when the reservation is confirmed.
 */
export async function sendBookingConfirmationNotification(booking: BookingNotificationTarget): Promise<boolean> {
  if (booking.confirmationSendStatus === 'sent' || booking.confirmationSentAt) {
    console.log(`[Notification] Confirmation already sent for booking ${booking._id || booking.booking_reference}. Skipping duplicate send.`);
    return true;
  }

  const propertyName = booking.propertyName || 'Our Hotel';
  const checkInDate = booking.checkInDate || 'your check-in date';
  const checkOutDate = booking.checkOutDate || 'your check-out date';
  const ref = booking.booking_reference || String(booking._id || '');
  const guestContact = booking.guestEmail || booking.guest_phone || '';
  const payUrl = buildPayDepositUrl(booking);
  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const mode = resolveOnlinePaymentModeFromBooking(booking);
  const due = computeOnlinePaymentDue(stayTotal, mode);
  const depositDue = Number(booking.deposit_amount ?? due.amountDue);
  // Only treat as paid when the guest actually submitted proof (not when the
  // approval ledger merely reserved the expected deposit amount).
  const alreadyPaid = Boolean(
    booking.payment_proof_stored
    || booking.payment_proof_filename,
  )
    || (
      Number(booking.amount_paid ?? booking.amountPaid ?? 0) > 0
      && Boolean(booking.payment_transaction_ref)
    );
  const depositLabel = '50% deposit';

  const subject = alreadyPaid
    ? 'Your reservation is confirmed'
    : 'Reservation confirmed — please pay your deposit';
  const messageBody = alreadyPaid
    ? [
      `Hi ${guestFirstName(booking)},`,
      '',
      `Great news — your reservation at ${propertyName} has been confirmed.`,
      '',
      `Reference: ${ref}`,
      `Check-in: ${checkInDate}`,
      `Check-out: ${checkOutDate}`,
      '',
      'We look forward to welcoming you. If you have any questions before your stay, reply to this email or contact the hotel directly.',
      '',
      '— Madyaw Bookings',
    ].join('\n')
    : [
      `Hi ${guestFirstName(booking)},`,
      '',
      `Great news — your reservation at ${propertyName} has been confirmed.`,
      '',
      `Reference: ${ref}`,
      `Check-in: ${checkInDate}`,
      `Check-out: ${checkOutDate}`,
      '',
      `Please pay your ${depositLabel} of ₱${depositDue.toLocaleString()} to secure your stay:`,
      payUrl,
      '',
      'This secure link opens the Madyaw website where you can scan the hotel QR and upload your payment proof. It works even if you closed the browser earlier.',
      '',
      '— Madyaw Bookings',
    ].join('\n');

  try {
    if (String(booking.guestEmail).toLowerCase() === 'fail@notification.test' || String(booking.guest_phone) === 'FAIL') {
      throw new Error('Simulated delivery failure: Unable to reach guest contact method.');
    }

    if (!booking.guestEmail) {
      throw new Error('Guest email is required to send confirmation.');
    }

    const result = await deliverEmail(booking.guestEmail, subject, messageBody);
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
 * Email the guest when the hotel declines / cannot accommodate the request.
 * Includes a link to book again at the same hotel.
 */
export async function sendBookingDeclinedNotification(booking: BookingNotificationTarget): Promise<boolean> {
  if (booking.declineSendStatus === 'sent' || booking.declineSentAt) {
    return true;
  }

  const email = String(booking.guestEmail ?? '').trim();
  if (!email) return false;

  const propertyName = booking.propertyName || 'the hotel';
  const ref = booking.booking_reference || String(booking._id || '');
  const rebookUrl = buildRebookUrl(booking);

  const subject = 'Update on your reservation request';
  const messageBody = [
    `Hi ${guestFirstName(booking)},`,
    '',
    `Thank you for your interest in ${propertyName}. Unfortunately, your reservation request could not be confirmed for the dates you selected.`,
    '',
    `Reference: ${ref}`,
    '',
    'You can choose new dates and submit another request here:',
    rebookUrl,
    '',
    'We hope to welcome you on another stay.',
    '',
    '— Madyaw Bookings',
  ].join('\n');

  try {
    const result = await deliverEmail(email, subject, messageBody);
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
