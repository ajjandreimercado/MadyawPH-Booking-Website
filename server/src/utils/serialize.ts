import { resolveHotelOnlinePaymentMode, resolveOnlinePaymentModeFromBooking } from './halfPayment';
import {
  hasAnyPaymentQr,
  mergePaymentAccounts,
  mergePaymentQrs,
} from './paymentQr';

type AnyDocument = { _id: unknown; [key: string]: unknown };

function toId(value: unknown) {
  return String(value);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      return [];
    }
  }

  return [];
}

export function serializeProperty(property: AnyDocument) {
  const source = property as AnyDocument;
  const hotelId = source.hotel_id ?? source.hotelId;
  const categoryId = source.category_id ?? source.categoryId;
  const name = source.display_name ?? source.name ?? source.category_name ?? source.categoryName;
  const location = source.hotel_location ?? source.location ?? source.hotel_name ?? source.category_name ?? source.categoryName;
  const roomNumber = source.room_number ?? source.roomNumber ?? source.distance;
  const roomStatus = source.status ?? source.roomStatus;

  return {
    id: toId(property._id),
    _id: toId(property._id),
    hotelId: hotelId ? toId(hotelId) : undefined,
    categoryId: categoryId ? toId(categoryId) : undefined,
    name: name ? String(name) : '',
    location: location ? String(location) : '',
    distance: roomNumber ? String(roomNumber) : '',
    rating: Number(source.rating ?? source.average_rating ?? 4.8),
    reviews: Number(source.reviews ?? source.review_count ?? 0),
    price: Number(source.price_per_night ?? source.price ?? 0),
    image: String(source.image_url ?? source.image ?? ''),
    amenities: toStringArray(source.amenities),
    type: String(source.room_type ?? source.type ?? ''),
    featured: roomStatus ? String(roomStatus) === 'available' : Boolean(source.featured),
    roomNumber: roomNumber ? String(roomNumber) : undefined,
    roomStatus: roomStatus ? String(roomStatus) : undefined,
    description: source.description ? String(source.description) : undefined,
    categoryName: source.category_name ? String(source.category_name) : source.categoryName ? String(source.categoryName) : undefined,
    // Public listing must never expose in-house guest PII from shared hotel room docs.
    hotelName: source.hotel_name ? String(source.hotel_name) : source.hotelName ? String(source.hotelName) : undefined,
    hotelLocation: source.hotel_location ? String(source.hotel_location) : source.hotelLocation ? String(source.hotelLocation) : undefined,
  };
}

export function serializeHotel(hotel: AnyDocument, extras?: { systemSettings?: unknown }) {
  const coordinates = hotel.coordinates as { latitude?: unknown; longitude?: unknown } | undefined;
  const latitude = typeof coordinates?.latitude === 'number' ? coordinates.latitude : Number(coordinates?.latitude);
  const longitude = typeof coordinates?.longitude === 'number' ? coordinates.longitude : Number(coordinates?.longitude);
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

  const onlinePaymentMode = resolveHotelOnlinePaymentMode(extras?.systemSettings ?? hotel);
  const paymentQrs = mergePaymentQrs(hotel, extras?.systemSettings);
  const paymentAccounts = mergePaymentAccounts(hotel, extras?.systemSettings);
  const hotelId = toId(hotel._id);
  const proxyPath = `/hotels/${encodeURIComponent(hotelId)}/payment-qr`;

  return {
    id: hotelId,
    _id: hotelId,
    name: hotel.name,
    location: hotel.location,
    city: hotel.city ? String(hotel.city) : undefined,
    contactNumber: hotel.contact_number,
    imageUrl: hotel.image_url ? String(hotel.image_url) : undefined,
    latitude: hasCoords ? latitude : undefined,
    longitude: hasCoords ? longitude : undefined,
    onlinePaymentMode,
    depositPercent: onlinePaymentMode === 'full' ? 100 : 50,
    hasPaymentQr: hasAnyPaymentQr(paymentQrs),
    paymentQrs: hasAnyPaymentQr(paymentQrs)
      ? {
          gcash: paymentQrs.gcash ? proxyPath : undefined,
          maya: paymentQrs.maya ? proxyPath : undefined,
          bank: paymentQrs.bank ? proxyPath : undefined,
          generic: proxyPath,
        }
      : paymentQrs,
    paymentAccounts,
  };
}

export function serializeRoomCategory(category: AnyDocument) {
  const source = category as AnyDocument;
  const hotelId = source.hotel_id ?? source.hotelId;

  return {
    id: toId(category._id),
    _id: toId(category._id),
    hotelId: hotelId ? toId(hotelId) : '',
    name: String(source.name ?? ''),
    description: String(source.description ?? ''),
    defaultPrice: Number(source.default_price ?? source.defaultPrice ?? 0),
    imageUrl: String(source.image_url ?? source.imageUrl ?? ''),
  };
}

export function serializeUser(user: AnyDocument) {
  // IMPORTANT: Use an explicit allowlist — never spread the whole document.
  // This prevents password, lockout fields, and googleSub from leaking into API responses.
  return {
    id: toId(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    partner: user.partner,
    // favorites can be exposed to the owner (auth context uses this for wishlist)
    favorites: Array.isArray(user.favorites) ? user.favorites : [],
    // avatar is the Google profile picture URL — safe to expose to the owner
    avatar: user.avatar ? String(user.avatar) : undefined,
    authProvider: user.authProvider ? String(user.authProvider) : 'local',
    emailVerified: Boolean(user.emailVerified),
  };
}


export function serializeBooking(booking: AnyDocument) {
  return {
    id: toId(booking._id),
    bookingReference: booking.booking_reference,
    hotelId: booking.hotel_id ? toId(booking.hotel_id) : undefined,
    roomId: booking.room_id ? toId(booking.room_id) : undefined,
    propertyId: booking.propertyId,
    propertyName: booking.propertyName,
    guestName: booking.guestName ?? booking.guest_name,
    guestEmail: booking.guestEmail ?? booking.guest_email,
    guestPhone: booking.guest_phone,
    checkInDate: booking.checkInDate
      ?? (booking.check_in_date ? new Date(booking.check_in_date as string | number | Date).toISOString().slice(0, 10) : undefined),
    checkOutDate: booking.checkOutDate
      ?? (booking.check_out_date ? new Date(booking.check_out_date as string | number | Date).toISOString().slice(0, 10) : undefined),
    checkInTime: booking.check_in_time,
    checkOutTime: booking.check_out_time,
    adults: booking.adults,
    children: booking.children,
    infants: booking.infants,
    roomType: booking.roomType,
    paymentMethod: booking.paymentMethod,
    source: booking.source,
    bookingType: booking.booking_type,
    nights: booking.nights,
    guestCount: booking.guestCount,
    roomRate: booking.roomRate,
    serviceFee: booking.serviceFee,
    totalAmount: Number(booking.total_amount ?? booking.totalPrice ?? 0),
    discountAmount: booking.discount_amount,
    discountReason: booking.discount_reason,
    status: booking.status,
    requestedAt: booking.requestedAt,
    expiresAt: booking.expiresAt,
    totalPrice: Number(booking.totalPrice ?? booking.total_amount ?? 0),
    amountPaid: Number(booking.amountPaid ?? booking.amount_paid ?? 0),
    balanceDue: booking.balance_due != null
      ? Number(booking.balance_due)
      : Math.max(
        0,
        Number(booking.total_amount ?? booking.totalPrice ?? 0) - Number(booking.amountPaid ?? booking.amount_paid ?? 0),
      ),
    depositAmount: Number(booking.deposit_amount ?? booking.amountPaid ?? booking.amount_paid ?? 0),
    onlinePaymentMode: resolveOnlinePaymentModeFromBooking(booking),
    depositPercent: resolveOnlinePaymentModeFromBooking(booking) === 'full' ? 100 : Number(booking.deposit_percent ?? 50),
    membershipId: booking.member_shid_id ? String(booking.member_shid_id) : undefined,
    discountType: booking.discount_type ? String(booking.discount_type) : undefined,
    checkInAt: booking.check_in_at,
    checkOutAt: booking.check_out_at,
    paymentStatus: booking.payment_status,
    validIdUploaded: Boolean(booking.valid_id_filename || booking.valid_id_stored || booking.valid_id_base64),
    validIdFilename: booking.valid_id_filename ?? '',
    hotelLedgerSynced: Boolean(booking.hotel_ledger_synced),
    hotelQueueSynced: Boolean(booking.hotel_queue_synced),
    confirmationSentAt: booking.confirmationSentAt ? new Date(booking.confirmationSentAt as string | number | Date).toISOString() : null,
    confirmationSendStatus: booking.confirmationSendStatus ?? 'none',
    // Never expose provider/transport error text to clients.
    confirmationSendError: '',
  };
}

export function serializeReview(review: AnyDocument) {
  return {
    id: toId(review._id),
    hotelId: review.hotel_id ? toId(review.hotel_id) : undefined,
    bookingId: review.booking_id ? toId(review.booking_id) : undefined,
    roomId: review.room_id ? toId(review.room_id) : undefined,
    guestName: review.guest_name,
    propertyId: review.propertyId,
    authorName: review.authorName,
    rating: review.rating,
    title: review.title,
    comment: review.comment,
    submittedAt: review.submitted_at,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}