import { getEmailFrom, getResendApiKey } from '../config/env';

export interface BookingNotificationTarget {
  _id?: unknown;
  booking_reference?: string;
  propertyName?: string;
  guestName?: string;
  guestEmail?: string;
  guest_phone?: string;
  checkInDate?: string;
  confirmationSendStatus?: string;
  confirmationSentAt?: Date | string | null;
  confirmationSendError?: string;
  save?: () => Promise<unknown>;
}

interface EmailSendResult {
  delivered: boolean;
  provider: 'resend' | 'console';
  error?: string;
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
    // Keep provider bodies in server logs only (never return them via serializeBooking).
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
 * Sends a confirmation message to the guest when the reservation is confirmed.
 * Uses Resend when RESEND_API_KEY is set; otherwise logs to console and records failure
 * so the UI never claims an email was delivered without a real provider.
 */
export async function sendBookingConfirmationNotification(booking: BookingNotificationTarget): Promise<boolean> {
  if (booking.confirmationSendStatus === 'sent' || booking.confirmationSentAt) {
    console.log(`[Notification] Confirmation already sent for booking ${booking._id || booking.booking_reference}. Skipping duplicate send.`);
    return true;
  }

  const propertyName = booking.propertyName || 'Our Hotel';
  const checkInDate = booking.checkInDate || 'your check-in date';
  const guestContact = booking.guestEmail || booking.guest_phone || '';

  const subject = 'Reservation Confirmed';
  const messageBody = `Thank you for choosing ${propertyName}!\nYour reservation has been successfully confirmed. We look forward to welcoming you on ${checkInDate}. If you have any questions or need assistance before your stay, feel free to contact us. See you soon!`;

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
      booking.confirmationSendStatus = 'failed';
      booking.confirmationSendError = result.error || 'Email provider unavailable.';
      if (typeof booking.save === 'function') {
        await booking.save();
      }
      console.warn(`[Notification] Not delivered via ${result.provider}: ${result.error}`);
      return false;
    }

    booking.confirmationSendStatus = 'sent';
    booking.confirmationSentAt = sentTimestamp;
    booking.confirmationSendError = '';

    if (typeof booking.save === 'function') {
      await booking.save();
    }

    console.log(`[Notification Success] Provider=${result.provider} To=${guestContact} At=${sentTimestamp.toISOString()}`);
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown delivery failure';
    console.error(`[Notification Failure] Failed to send confirmation message to ${guestContact}: ${errorMessage}`);

    booking.confirmationSendStatus = 'failed';
    booking.confirmationSendError = errorMessage;

    if (typeof booking.save === 'function') {
      await booking.save();
    }
    return false;
  }
}
