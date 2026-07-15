import type { BookingStatus, Property } from '../types';
import type { BookingDraft } from './bookingFlow';

interface BookingNotificationPayload {
  bookingId: string;
  property: Property;
  guestName: string;
  guestEmail: string;
  status: BookingStatus;
  booking?: BookingDraft & { nights: number; guestCount: number; totalPrice: number };
  message?: string;
}

function logNotification(channel: 'email-confirmation' | 'admin-partner-alert', payload: BookingNotificationPayload) {
  console.info(`[notification:${channel}]`, {
    bookingId: payload.bookingId,
    propertyId: payload.property.id,
    propertyName: payload.property.name,
    guestName: payload.guestName,
    guestEmail: payload.guestEmail,
    status: payload.status,
    checkInDate: payload.booking?.checkInDate,
    checkOutDate: payload.booking?.checkOutDate,
    adults: payload.booking?.adults,
    children: payload.booking?.children,
    infants: payload.booking?.infants,
    roomType: payload.booking?.roomType,
    paymentMethod: payload.booking?.paymentMethod,
    nights: payload.booking?.nights,
    guestCount: payload.booking?.guestCount,
    totalPrice: payload.booking?.totalPrice,
    message: payload.message,
  });
}

export function sendEmailConfirmation(payload: BookingNotificationPayload) {
  logNotification('email-confirmation', payload);
}

export function sendAdminPartnerAlert(payload: BookingNotificationPayload) {
  logNotification('admin-partner-alert', payload);
}