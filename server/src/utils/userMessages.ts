/**
 * Guest-safe copy for API responses — no env vars, field names, or developer jargon.
 */

const FIELD_LABELS: Record<string, string> = {
  propertyId: 'room',
  hotelId: 'hotel',
  bookingId: 'booking',
  checkInDate: 'check-in date',
  checkOutDate: 'check-out date',
  guestName: 'guest name',
  guestEmail: 'email address',
  guestPhone: 'phone number',
  roomType: 'room type',
  paymentMethod: 'payment method',
  promoCode: 'promo code',
  membershipId: 'membership ID',
  propertyName: 'property name',
  specialRequests: 'special requests',
  discountReason: 'discount reason',
  authorName: 'your name',
  title: 'review title',
  comment: 'review comment',
  rating: 'rating',
  code: 'promo code',
  discount_type: 'discount type',
  discount_value: 'discount amount',
  credential: 'Google sign-in',
  name: 'name',
  email: 'email address',
  password: 'password',
  status: 'booking status',
  adults: 'number of adults',
  children: 'number of children',
  infants: 'number of infants',
};

/** Turn camelCase / snake_case API field names into plain language. */
export function humanizeFieldName(fieldName: string): string {
  const trimmed = fieldName.trim();
  if (FIELD_LABELS[trimmed]) return FIELD_LABELS[trimmed];
  return trimmed
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bid\b/gi, 'ID')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const USER_MESSAGES = {
  signInRequired: 'Please sign in to continue.',
  sessionExpired: 'Your session has expired. Please sign in again.',
  accountNotFound: 'We could not find your account. Please sign in again.',
  accessDenied: 'You do not have permission to do that.',
  bookingNotFound: 'We could not find that booking.',
  hotelNotFound: 'We could not find that hotel.',
  roomNotFound: 'We could not find that room.',
  serviceUnavailable: 'This service is temporarily unavailable. Please try again later.',
  unexpectedError: 'Something went wrong on our end. Please try again in a moment.',
  confirmationLinkInvalid:
    'This confirmation link is incomplete or has expired. Please use the link from your booking email.',
  confirmationLinkMismatch:
    'This confirmation link does not match this booking. Please use the link from your booking email.',
  choosePaymentMethod: 'Please choose a supported payment method.',
  selectDatesAndRoom: 'Please select a room with check-in and check-out dates.',
  invalidDates: 'Please enter valid check-in and check-out dates.',
} as const;
