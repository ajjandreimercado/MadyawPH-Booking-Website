import type { Property } from '../types';
import type { BookingDraft } from './bookingFlow';

type AnalyticsEventName = 'search_submitted' | 'card_viewed' | 'details_viewed' | 'booking_requested';

interface AnalyticsPayload {
  [key: string]: string | number | boolean | null | undefined;
}

function track(eventName: AnalyticsEventName, payload: AnalyticsPayload) {
  console.info(`[analytics] ${eventName}`, payload);
}

export function trackSearchSubmitted(payload: { destination: string; guests: number; rooms: number }) {
  track('search_submitted', payload);
}

export function trackCardViewed(property: Property) {
  track('card_viewed', {
    propertyId: property.id,
    propertyName: property.name,
    location: property.location,
  });
}

export function trackDetailsViewed(property: Property) {
  track('details_viewed', {
    propertyId: property.id,
    propertyName: property.name,
    location: property.location,
  });
}

export function trackBookingRequested(payload: {
  bookingId: string;
  property: Property;
  guestName: string;
  guestEmail: string;
  booking: BookingDraft & { totalPrice: number; nights: number; guestCount: number };
}) {
  track('booking_requested', {
    bookingId: payload.bookingId,
    propertyId: payload.property.id,
    propertyName: payload.property.name,
    guestName: payload.guestName,
    guestEmail: payload.guestEmail,
    checkInDate: payload.booking.checkInDate,
    checkOutDate: payload.booking.checkOutDate,
    adults: payload.booking.adults,
    children: payload.booking.children,
    infants: payload.booking.infants,
    roomType: payload.booking.roomType,
    paymentMethod: payload.booking.paymentMethod,
    nights: payload.booking.nights,
    guestCount: payload.booking.guestCount,
    totalPrice: payload.booking.totalPrice,
  });
}