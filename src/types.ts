export interface Property {
  id: string;
  _id?: string;
  hotelId?: string;
  categoryId?: string;
  name: string;
  location: string;
  distance: string;
  rating: number;
  reviews: number;
  price: number;
  image: string;
  amenities: string[];
  type: string;
  featured?: boolean;
  roomNumber?: string;
  roomStatus?: string;
  categoryName?: string;
  hotelName?: string;
  hotelLocation?: string;
  currentGuestName?: string;
  currentCheckIn?: string;
  currentCheckOut?: string;
}

export interface Hotel {
  id: string;
  name: string;
  location: string;
  city?: string;
  contactNumber: string;
  imageUrl?: string;
  latitude?: number;
  longitude?: number;
  /** Hotel-app setting: half (50%) or full stay for online bookings. */
  onlinePaymentMode?: 'half' | 'full';
  depositPercent?: number;
  hasPaymentQr?: boolean;
  /** Embedded QR bytes from the API when the file can be loaded. */
  paymentQrDataUrl?: string;
  /** QR images uploaded in the hotel app. */
  paymentQrs?: {
    gcash?: string;
    maya?: string;
    bank?: string;
    generic?: string;
  };
  paymentAccounts?: {
    gcash?: string;
    maya?: string;
    bank?: string;
  };
}

export interface RoomCategory {
  id: string;
  hotelId: string;
  name: string;
  description: string;
  defaultPrice: number;
  imageUrl: string;
}

export interface Room {
  id: string;
  hotelId: string;
  categoryId: string;
  categoryName: string;
  displayName: string;
  roomNumber: string;
  roomType: string;
  pricePerNight: number;
  status: string;
  amenities: string[];
  imageUrl: string;
}

export interface FilterState {
  priceRange: number[];
  types: string[];
  rating: number;
  amenities: string[];
}

export type BookingStatus =
  | 'requested'
  | 'accepted'
  | 'declined'
  | 'paid'
  | 'confirmed'
  | 'pending'
  | 'reserved'
  | 'booked'
  | 'cancelled'
  | 'completed';

export type BookingRoomType = 'standard-room' | 'deluxe-suite' | 'family-suite' | 'villa-retreat';

export type BookingPaymentMethod = 'credit-card' | 'debit-card' | 'gcash' | 'maya' | 'bank-transfer';

export interface BookingRequest {
  id: string;
  bookingReference?: string;
  hotelId?: string;
  roomId?: string;
  propertyId: string;
  propertyName: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime?: string;
  checkOutTime?: string;
  adults: number;
  children: number;
  infants: number;
  roomType: BookingRoomType;
  paymentMethod: BookingPaymentMethod;
  source?: string;
  bookingType?: string;
  nights: number;
  guestCount: number;
  roomRate: number;
  serviceFee: number;
  status: BookingStatus;
  requestedAt: string;
  expiresAt: string;
  totalPrice: number;
  totalAmount?: number;
  amountPaid?: number;
  balanceDue?: number;
  depositAmount?: number;
  onlinePaymentMode?: 'half' | 'full';
  depositPercent?: number;
  membershipId?: string;
  discountType?: string;
  discountAmount?: number;
  discountReason?: string;
  checkInAt?: string;
  checkOutAt?: string;
  paymentStatus?: string;
  validIdUploaded?: boolean;
  validIdFilename?: string;
  paymentProofUploaded?: boolean;
  paymentProofFilename?: string;
  confirmationSentAt?: string | null;
  confirmationSendStatus?: 'none' | 'sent' | 'failed';
  confirmationSendError?: string;
}
