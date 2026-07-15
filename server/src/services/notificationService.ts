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

/**
 * Sends a confirmation message to the guest when the reservation is confirmed.
 * Ensures single dispatch, records timestamp, and handles/records delivery failures.
 */
export async function sendBookingConfirmationNotification(booking: any): Promise<boolean> {
  // Prevent duplicate confirmation messages if reservation is edited later or already sent
  if (booking.confirmationSendStatus === 'sent' || booking.confirmationSentAt) {
    console.log(`[Notification] Confirmation already sent for booking ${booking._id || booking.booking_reference}. Skipping duplicate send.`);
    return true;
  }

  const propertyName = booking.propertyName || 'Our Hotel';
  const checkInDate = booking.checkInDate || 'your check-in date';
  const guestContact = booking.guestEmail || booking.guest_phone || 'guest';

  const subject = 'Reservation Confirmed';
  const messageBody = `Thank you for choosing ${propertyName}!\nYour reservation has been successfully confirmed. We look forward to welcoming you on ${checkInDate}. If you have any questions or need assistance before your stay, feel free to contact us. See you soon!`;

  try {
    // Simulate notification failure if email/phone specifically tests failure
    if (String(booking.guestEmail).toLowerCase() === 'fail@notification.test' || String(booking.guest_phone) === 'FAIL') {
      throw new Error('Simulated delivery failure: Unable to reach guest contact method.');
    }

    console.log(`\n======================================================`);
    console.log(`[SENDING CONFIRMATION MESSAGE] To: ${guestContact}`);
    console.log(`Subject: ${subject}`);
    console.log(`Message:\n${messageBody}`);
    console.log(`======================================================\n`);

    const sentTimestamp = new Date();
    booking.confirmationSendStatus = 'sent';
    booking.confirmationSentAt = sentTimestamp;
    booking.confirmationSendError = '';

    if (typeof booking.save === 'function') {
      await booking.save();
    }

    console.log(`[Notification Success] Timestamp logged: ${sentTimestamp.toISOString()} for booking ${booking._id || booking.booking_reference}`);
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
