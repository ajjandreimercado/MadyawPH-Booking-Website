export type BookingRoomType = 'standard-room' | 'deluxe-suite' | 'family-suite' | 'villa-retreat';

export interface BookingPricingInput {
  propertyPrice: number;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  infants: number;
  roomType: BookingRoomType;
}

export interface BookingPricingBreakdown {
  nights: number;
  guestCount: number;
  roomRate: number;
  roomTotal: number;
  serviceFee: number;
  totalPrice: number;
}

const ROOM_TYPE_MULTIPLIERS: Record<BookingRoomType, number> = {
  'standard-room': 1,
  'deluxe-suite': 1.18,
  'family-suite': 1.3,
  'villa-retreat': 1.48,
};

function toDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date value.');
  }
  return parsed;
}

export function calculateBookingPricing(input: BookingPricingInput): BookingPricingBreakdown {
  const checkIn = toDate(input.checkInDate);
  const checkOut = toDate(input.checkOutDate);
  const diffMs = checkOut.getTime() - checkIn.getTime();
  const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const guestCount = Math.max(1, input.adults + input.children + input.infants);
  const roomRate = Math.round(input.propertyPrice * (ROOM_TYPE_MULTIPLIERS[input.roomType] ?? 1));
  const roomSubtotal = roomRate * nights;
  const guestSupplement = Math.round(roomSubtotal * ((Math.max(0, input.adults - 2) * 0.035) + (input.children * 0.015)));
  const serviceFee = Math.max(40, Math.round(roomSubtotal * 0.12));

  return {
    nights,
    guestCount,
    roomRate,
    roomTotal: roomSubtotal + guestSupplement,
    serviceFee,
    totalPrice: roomSubtotal + guestSupplement + serviceFee,
  };
}