import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { BookingPaymentMethod, BookingRequest, BookingRoomType, Property } from '../types';

export interface BookingDraft {
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  infants: number;
  roomType: BookingRoomType;
  paymentMethod: BookingPaymentMethod;
  /** Optional discount reason (e.g. 'pwd', 'senior citizen') — mirrored from server allowlist */
  discountReason?: string;
}

export const ROOM_TYPE_OPTIONS: Record<BookingRoomType, { label: string; description: string; multiplier: number }> = {
  'standard-room': {
    label: 'Standard Room',
    description: 'A serene base for couples and short stays.',
    multiplier: 1,
  },
  'deluxe-suite': {
    label: 'Deluxe Suite',
    description: 'Extra space with a polished premium feel.',
    multiplier: 1.18,
  },
  'family-suite': {
    label: 'Family Suite',
    description: 'Roomier setup for groups and longer holidays.',
    multiplier: 1.3,
  },
  'villa-retreat': {
    label: 'Villa Retreat',
    description: 'The most private stay with the highest comfort tier.',
    multiplier: 1.48,
  },
};

export const PAYMENT_METHOD_OPTIONS: Record<BookingPaymentMethod, { label: string; description: string }> = {
  'credit-card': {
    label: 'Credit Card',
    description: 'Visa, Mastercard, JCB — instant confirmation.',
  },
  'debit-card': {
    label: 'Debit Card',
    description: 'Any Philippine bank debit card.',
  },
  gcash: {
    label: 'GCash',
    description: 'Mobile wallet checkout for quick payment capture.',
  },
  maya: {
    label: 'Maya',
    description: 'Pay via Maya digital wallet.',
  },
  'bank-transfer': {
    label: 'Bank Transfer',
    description: 'Best for travelers who prefer a manual transfer.',
  },
};

export interface BookingPricingBreakdown {
  nights: number;
  guestCount: number;
  roomRate: number;
  roomTotal: number;
  serviceFee: number;
  discountAmount: number;
  totalPrice: number;
}

export function calculateBookingPricing(
  property: Property,
  draft: BookingDraft & { discountReason?: string },
): BookingPricingBreakdown {
  const nights = Math.max(1, differenceInCalendarDays(parseISO(draft.checkOutDate), parseISO(draft.checkInDate)));
  const guestCount = Math.max(1, draft.adults + draft.children + draft.infants);
  const roomRate = Math.round(property.price * (ROOM_TYPE_OPTIONS[draft.roomType]?.multiplier ?? 1));
  const roomSubtotal = roomRate * nights;
  const guestSupplement = Math.round(roomSubtotal * ((Math.max(0, draft.adults - 2) * 0.035) + (draft.children * 0.015)));
  const serviceFee = 0;
  const subtotal = roomSubtotal + guestSupplement;

  // Mirror the server-side discount logic so the UI shows an accurate price preview.
  const normalizedDiscount = draft.discountReason?.trim().toLowerCase();
  const eligibleReasons = new Set(['pwd', 'senior citizen']);
  const discountAmount = (normalizedDiscount && eligibleReasons.has(normalizedDiscount))
    ? Math.round(subtotal * 0.2)
    : 0;

  return {
    nights,
    guestCount,
    roomRate,
    roomTotal: roomSubtotal + guestSupplement,
    serviceFee,
    discountAmount,
    totalPrice: Math.max(0, subtotal - discountAmount),
  };
}

export type OnlinePaymentMode = 'half' | 'full';

export function computeOnlinePaymentDue(
  totalAmount: number,
  mode: OnlinePaymentMode = 'half',
): { mode: OnlinePaymentMode; depositPercent: number; amountDue: number; balanceDue: number } {
  const total = Math.max(0, Math.round(Number(totalAmount) || 0));
  if (mode === 'full') {
    return { mode: 'full', depositPercent: 100, amountDue: total, balanceDue: 0 };
  }
  const amountDue = Math.floor(total / 2);
  return {
    mode: 'half',
    depositPercent: 50,
    amountDue,
    balanceDue: Math.max(0, total - amountDue),
  };
}

export const BOOKING_REQUEST_EXPIRY_SECONDS = 90;
export const BOOKING_RECHECK_DELAY_MS = 2600;
export const BOOKING_PAYMENT_PROCESSING_MS = 1600;

export const DISCOUNT_OPTIONS = [
  { value: 'none', label: 'No discount' },
  { value: 'pwd', label: 'PWD' },
  { value: 'senior citizen', label: 'Senior Citizen' },
] as const;

export function discountLabel(discountReason?: string) {
  if (!discountReason) {
    return 'No discount';
  }

  const normalizedReason = discountReason.toLowerCase();
  return DISCOUNT_OPTIONS.find((option) => option.value === normalizedReason)?.label ?? 'Discount';
}

export function createBookingRequest(property: Property, guestName: string, guestEmail: string, draft: BookingDraft & { discountReason?: string }): BookingRequest {
  const createdAt = Date.now();
  const pricing = calculateBookingPricing(property, draft);

  return {
    id: `REQ-${property.id}-${createdAt}`,
    propertyId: property.id,
    propertyName: property.name,
    guestName,
    guestEmail,
    checkInDate: draft.checkInDate,
    checkOutDate: draft.checkOutDate,
    adults: draft.adults,
    children: draft.children,
    infants: draft.infants,
    roomType: draft.roomType,
    paymentMethod: draft.paymentMethod,
    nights: pricing.nights,
    guestCount: pricing.guestCount,
    roomRate: pricing.roomRate,
    serviceFee: pricing.serviceFee,
    status: 'requested',
    requestedAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + BOOKING_REQUEST_EXPIRY_SECONDS * 1000).toISOString(),
    totalPrice: pricing.totalPrice,
  };
}

export async function recheckAvailability(propertyId: string, checkInDate?: string, checkOutDate?: string) {
  // Try to call the backend availability endpoint. Falls back to "unavailable" if the API cannot be reached.
  try {
    const params = new URLSearchParams();
    params.set('propertyId', propertyId);
    if (checkInDate) params.set('checkInDate', checkInDate);
    if (checkOutDate) params.set('checkOutDate', checkOutDate);

    const res = await fetch(`/api/bookings/availability?${params.toString()}`, { method: 'GET' });
    if (!res.ok) {
      return { available: false, message: 'We could not check availability right now. Please try again.' };
    }

    const body = await res.json();
    return { available: Boolean(body.available), message: body.message ?? '' };
  } catch (err) {
    await new Promise(resolve => window.setTimeout(resolve, BOOKING_RECHECK_DELAY_MS));
    return { available: false, message: 'Unable to check availability at this time.' };
  }
}

export function formatCountdown(secondsRemaining: number) {
  const minutes = Math.floor(secondsRemaining / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.max(0, secondsRemaining % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${seconds}`;
}