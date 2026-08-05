import { Router, type Request } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { BookingModel, ExternalReservationModel, PropertyModel, UserModel } from '../data/mongoModels';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { availabilityLimiter, bookingCreateLimiter, hotelWebhookLimiter } from '../middleware/rateLimiters';
import { isPrivilegedRole } from '../middleware/rbac';
import { calculateBookingPricing } from '../utils/pricing';
import { serializeBooking } from '../utils/serialize';
import { sendBookingConfirmationNotification, sendBookingRequestReceivedNotification, sendBookingDeclinedNotification } from '../services/notificationService';
import { createPaymentCheckout } from '../services/paymentService';
import { applyHotelBookingDecision } from '../services/hotelBookingSync';
import { resolvePromoDiscount, incrementPromoUse } from '../utils/promo';
import { signReceiptToken, verifyReceiptToken } from '../utils/receiptToken';
import { buildHotelAppBookingFields, toStayDate } from '../utils/hotelAppBookingFields';
import { buildExternalReservationDoc } from '../utils/externalReservation';
import { computeHalfPayment } from '../utils/halfPayment';
import { withRetries } from '../utils/withRetries';
import { runValidIdUpload, type UploadedValidIdFile } from '../middleware/validIdUpload';
import { CLIENT_ORIGINS, getHotelWebhookSecret } from '../config/env';
// OWASP A03: schema-based field stripping and input validators
import {
  pickFields,
  validateString,
  validateOptionalString,
  validateEmail,
  validatePhone,
  validateInteger,
  validateOptionalInteger,
  validatePositiveNumber,
  validateEnum,
  validateOptionalEnum,
  validateId,
} from '../utils/validators';

const bookingRoutes = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = 'guest' | 'partner' | 'admin' | 'staff' | 'super_admin';
type BookingStatus = 'requested' | 'accepted' | 'declined' | 'paid' | 'confirmed' | 'pending' | 'cancelled';

const ACTIVE_BOOKING_STATUSES = ['requested', 'accepted', 'paid', 'confirmed', 'pending'] as const;

// Allowlists — validated server-side, never taken verbatim from client input (OWASP A03)
const ROOM_TYPE_VALUES = ['standard-room', 'deluxe-suite', 'family-suite', 'villa-retreat'] as const;
const PAYMENT_METHOD_VALUES = ['credit-card', 'debit-card', 'gcash', 'maya', 'bank-transfer'] as const;
const BOOKING_STATUS_VALUES = ['requested', 'accepted', 'declined', 'paid', 'confirmed', 'pending', 'cancelled'] as const;

// Guests may only cancel pre-confirmation requests — hotel app owns confirm/cancel after confirm.
const GUEST_STATUS_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  pending: ['cancelled'],
  requested: ['cancelled'],
  accepted: ['cancelled'],
};

/** Canonical discount reasons accepted by pricing. Aliases keep older clients working. */
function normalizeDiscountReason(discountReason: string | undefined): 'pwd' | 'senior citizen' | undefined {
  const normalized = discountReason?.trim().toLowerCase() ?? '';
  if (!normalized || normalized === 'none') return undefined;
  if (normalized === 'pwd' || normalized.includes('pwd')) return 'pwd';
  if (
    normalized === 'senior citizen'
    || normalized === 'senior'
    || normalized.includes('senior')
  ) {
    return 'senior citizen';
  }
  return undefined;
}

function resolveServerDiscount(
  discountReason: string | undefined,
  pricingTotal: number,
  clientDiscountAmount?: number,
): number {
  const canonicalReason = normalizeDiscountReason(discountReason);

  if (!canonicalReason) {
    return 0;
  }

  const serverDiscount = Math.round(pricingTotal * 0.2);
  const requested = Number(clientDiscountAmount ?? 0);

  if (!Number.isFinite(requested) || requested < 0) {
    return serverDiscount;
  }

  return Math.min(serverDiscount, Math.round(requested));
}

/** Map legacy / display aliases onto the payment-method allowlist. */
function normalizePaymentMethod(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'paymaya' || normalized === 'pay maya') return 'maya';
  if (normalized === 'credit card' || normalized === 'creditcard') return 'credit-card';
  if (normalized === 'debit card' || normalized === 'debitcard') return 'debit-card';
  if (normalized === 'bank transfer' || normalized === 'banktransfer') return 'bank-transfer';
  return normalized;
}

async function hasBookingOverlap(
  propertyId: string,
  checkInDate: string,
  checkOutDate: string,
  excludeBookingId?: string,
  session?: mongoose.ClientSession | null,
) {
  console.log(`[MongoDB Query] Collection: bookings, Query: ${JSON.stringify({ propertyId, status: { $in: ACTIVE_BOOKING_STATUSES } })}`);
  const query = BookingModel.find({
    propertyId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
  });
  if (session) query.session(session);
  const bookings = await query.lean();
  console.log(`[MongoDB Results] Collection: bookings, Retrieved: ${bookings.length} documents`);

  const requestedStart = new Date(checkInDate);
  const requestedEnd = new Date(checkOutDate);

  if (Number.isNaN(requestedStart.getTime()) || Number.isNaN(requestedEnd.getTime())) {
    throw new Error('Invalid check-in or check-out date.');
  }

  return bookings.some((booking) => {
    if (excludeBookingId && String(booking._id) === excludeBookingId) {
      return false;
    }

    const startRaw = booking.checkInDate ?? booking.check_in_date;
    const endRaw = booking.checkOutDate ?? booking.check_out_date;
    if (!startRaw || !endRaw) return false;

    const existingStart = new Date(startRaw as string | Date);
    const existingEnd = new Date(endRaw as string | Date);
    if (Number.isNaN(existingStart.getTime()) || Number.isNaN(existingEnd.getTime())) {
      return false;
    }
    return requestedStart < existingEnd && requestedEnd > existingStart;
  });
}

function isTransactionUnsupported(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('transaction numbers are only allowed')
    || message.includes('transactions are not supported')
    || message.includes('replica set')
    || message.includes('illegaloperation')
  );
}

async function getRequestUser(req: Request) {
  if (!req.auth?.userId) {
    return null;
  }

  console.log(`[MongoDB Query] Collection: users, Action: findById, ID: ${req.auth.userId}`);
  const user = await UserModel.findById(req.auth.userId)
    .select({ _id: 1, email: 1, name: 1, role: 1, hotel_id: 1 })
    .lean();
  console.log(`[MongoDB Results] Collection: users, Action: findById, Found: ${user ? 1 : 0}`);

  if (!user) {
    return null;
  }

  return {
    id: String(user._id),
    email: String(user.email).toLowerCase(),
    name: String(user.name ?? ''),
    role: user.role as UserRole,
    hotelId: user.hotel_id ? String(user.hotel_id) : null,
  };
}

/** Staff/admin may only touch bookings for their hotel; super_admin may touch any. */
function staffCanAccessBooking(
  role: UserRole,
  staffHotelId: string | null | undefined,
  bookingHotelId: unknown,
): boolean {
  if (role === 'super_admin') return true;
  if (!staffHotelId) return false;
  return String(bookingHotelId ?? '') === staffHotelId;
}

// ─── GET / ────────────────────────────────────────────────────────────────────
// requireAuth: unauthenticated callers receive 401; never returns all bookings to the public.

bookingRoutes.get('/', requireAuth, async (req, res) => {
  const requester = await getRequestUser(req);

  if (!requester) {
    // req.auth was valid (requireAuth passed) but the user no longer exists in DB.
    return res.status(401).json({ message: 'Authenticated user not found.' });
  }

  // Pagination — clamped to safe bounds (OWASP A04)
  const pageNum = Math.max(1, Number(req.query.page) || 1);
  // For guest-filtered queries we raise the limit so all personal bookings load at once
  const defaultLimit = !isPrivilegedRole(requester.role as UserRole) ? 100 : 20;
  const limitNum = Math.min(200, Math.max(1, Number(req.query.limit) || defaultLimit));
  const skip = (pageNum - 1) * limitNum;

  // Guests: own bookings only. Hotel staff/admin: their hotel_id only. super_admin: all.
  let filter: Record<string, unknown>;
  if (!isPrivilegedRole(requester.role as UserRole)) {
    filter = { guestEmail: requester.email };
  } else if (requester.role === 'super_admin') {
    filter = {};
  } else if (requester.hotelId) {
    filter = { hotel_id: requester.hotelId };
  } else {
    return res.status(403).json({ message: 'Access denied. Staff account has no hotel assigned.' });
  }

  console.log(`[MongoDB Query] Collection: bookings, Query: ${JSON.stringify(filter)}, Sort: { createdAt: -1 }, Page: ${pageNum}, Limit: ${limitNum}`);
  const [bookings, total] = await Promise.all([
    BookingModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
    BookingModel.countDocuments(filter),
  ]);
  console.log(`[MongoDB Results] Collection: bookings, Retrieved: ${bookings.length} documents`);

  return res.json({
    data: bookings.map(booking => serializeBooking(booking as never)),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
  });
});

// ─── GET /availability ────────────────────────────────────────────────────────
// Public endpoint — availabilityLimiter guards against date-enumeration attacks (OWASP A01)

bookingRoutes.get('/availability', availabilityLimiter, async (req, res) => {
  const { propertyId, checkInDate, checkOutDate } = req.query as {
    propertyId?: string;
    checkInDate?: string;
    checkOutDate?: string;
  };

  if (!propertyId || !checkInDate || !checkOutDate) {
    return res.status(400).json({ message: 'propertyId, checkInDate and checkOutDate are required.' });
  }

  // OWASP A03: validate propertyId length before passing to DB query
  const idResult = validateId(propertyId, 'propertyId');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }

  // Validate date strings are parseable ISO dates
  if (Number.isNaN(new Date(checkInDate).getTime()) || Number.isNaN(new Date(checkOutDate).getTime())) {
    return res.status(400).json({ message: 'checkInDate and checkOutDate must be valid dates.' });
  }

  try {
    const overlap = await hasBookingOverlap(idResult.value, checkInDate, checkOutDate);

    if (overlap) {
      return res.json({ available: false, message: 'The requested dates overlap with an existing booking.' });
    }

    return res.json({ available: true, message: 'No overlapping bookings found; property appears available.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to check availability.';
    return res.status(400).json({ message });
  }
});

// ─── POST /hotel-events ───────────────────────────────────────────────────────
// Hotel management app callback when an Online Booking is approved/rejected.
// Auth: Authorization: Bearer <HOTEL_WEBHOOK_SECRET>  (or X-Madyaw-Hotel-Secret)

function timingSafeEqualString(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function isHotelWebhookAuthorized(req: Request): boolean {
  const secret = getHotelWebhookSecret();
  if (!secret) return false;
  const header = req.header('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const alt = (req.header('x-madyaw-hotel-secret') ?? '').trim();
  const provided = bearer || alt;
  if (!provided) return false;
  return timingSafeEqualString(provided, secret);
}

bookingRoutes.post('/hotel-events', hotelWebhookLimiter, async (req, res) => {
  if (!getHotelWebhookSecret()) {
    return res.status(503).json({
      message: 'Hotel webhook is not configured. Set HOTEL_WEBHOOK_SECRET on the API.',
    });
  }
  if (!isHotelWebhookAuthorized(req)) {
    return res.status(401).json({ message: 'Invalid hotel webhook credentials.' });
  }

  const body = req.body as {
    event?: string;
    status?: string;
    bookingId?: string;
    booking_id?: string;
    bookingReference?: string;
    booking_reference?: string;
    external_reference?: string;
  };

  const status = String(body.status ?? body.event ?? '').trim();
  if (!status) {
    return res.status(400).json({ message: 'status or event is required.' });
  }

  const bookingId = String(body.bookingId ?? body.booking_id ?? '').trim() || undefined;
  const bookingReference = String(
    body.bookingReference ?? body.booking_reference ?? body.external_reference ?? '',
  ).trim() || undefined;

  if (!bookingId && !bookingReference) {
    return res.status(400).json({
      message: 'bookingId or bookingReference is required.',
    });
  }

  const result = await applyHotelBookingDecision({
    bookingId,
    bookingReference,
    status,
    source: 'webhook',
  });

  if (result.kind === 'not_found') {
    return res.status(404).json(result);
  }
  if (!result.ok) {
    return res.status(409).json(result);
  }
  return res.json(result);
});

// ─── POST / ───────────────────────────────────────────────────────────────────
// Public: unauthenticated guests submit their own name/email/phone in the form.
// No session token required — this is a guest booking website with no login.
// Accepts multipart/form-data with required Valid ID file.

bookingRoutes.post('/', bookingCreateLimiter, async (req, res) => {
  let validIdFile: UploadedValidIdFile | undefined;
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType.includes('multipart/form-data')) {
    try {
      validIdFile = await runValidIdUpload(req, res);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Valid ID upload failed.';
      const isSize = /File too large|LIMIT_FILE_SIZE/i.test(message);
      return res.status(400).json({
        message: isSize ? 'Valid ID must be 5 MB or smaller.' : message,
      });
    }
  }

  if (!validIdFile) {
    return res.status(400).json({ message: 'Please upload a valid ID (JPG, PNG, WEBP, or PDF, max 5 MB).' });
  }

  // OWASP A03: strip unexpected fields — only pick known booking fields
  // multipart fields arrive as strings; coerce occupancy numbers below.
  const body = pickFields(req.body, [
    'propertyId',
    'propertyName',
    'guestName',
    'guestEmail',
    'guestPhone',
    'checkInDate',
    'checkOutDate',
    'adults',
    'children',
    'infants',
    'roomType',
    'paymentMethod',
    'discountReason',
    'discountAmount',
    'specialRequests',
    'promoCode',
  ] as const);

  // ── Required field validation ─────────────────────────────────────────────

  const propertyIdResult = validateId(body.propertyId, 'Property ID');
  if (!propertyIdResult.ok) {
    return res.status(400).json({ message: propertyIdResult.message });
  }

  const checkInResult = validateString(body.checkInDate, 'Check-in date', 1, 30);
  if (!checkInResult.ok) return res.status(400).json({ message: checkInResult.message });

  const checkOutResult = validateString(body.checkOutDate, 'Check-out date', 1, 30);
  if (!checkOutResult.ok) return res.status(400).json({ message: checkOutResult.message });

  // Validate dates are actually parseable
  if (Number.isNaN(new Date(checkInResult.value).getTime())) {
    return res.status(400).json({ message: 'Check-in date is not a valid date.' });
  }
  if (Number.isNaN(new Date(checkOutResult.value).getTime())) {
    return res.status(400).json({ message: 'Check-out date is not a valid date.' });
  }

  if (new Date(checkOutResult.value) <= new Date(checkInResult.value)) {
    return res.status(400).json({ message: 'Check-out must be after check-in.' });
  }

  // Accept any string for room type (property room labels vary); normalize payment methods.
  const roomTypeResult = validateString(body.roomType, 'Room type', 1, 100);
  if (!roomTypeResult.ok) return res.status(400).json({ message: roomTypeResult.message });

  const rawPaymentMethod = validateString(body.paymentMethod, 'Payment method', 1, 100);
  if (!rawPaymentMethod.ok) return res.status(400).json({ message: rawPaymentMethod.message });
  const paymentMethodResult = validateEnum(
    normalizePaymentMethod(rawPaymentMethod.value),
    'Payment method',
    PAYMENT_METHOD_VALUES,
  );
  if (!paymentMethodResult.ok) return res.status(400).json({ message: paymentMethodResult.message });

  // ── Guest field validation ────────────────────────────────────────────────

  const rawGuestName = body.guestName;
  const guestNameResult = validateString(rawGuestName, 'Guest name', 1, 80);
  if (!guestNameResult.ok) return res.status(400).json({ message: guestNameResult.message });

  const rawGuestEmail = body.guestEmail;
  const guestEmailResult = validateEmail(rawGuestEmail);
  if (!guestEmailResult.ok) return res.status(400).json({ message: guestEmailResult.message });

  // Guest phone: required, format-validated (OWASP A03)
  const guestPhoneResult = validatePhone(body.guestPhone);
  if (!guestPhoneResult.ok) return res.status(400).json({ message: guestPhoneResult.message });

  // ── Numeric occupancy validation ──────────────────────────────────────────
  // OWASP A03: integer + range checks prevent garbage values in DB and pricing logic

  const adultsResult = validateInteger(Number(body.adults ?? 1), 'Adults', 1, 20);
  if (!adultsResult.ok) return res.status(400).json({ message: adultsResult.message });

  const childrenResult = validateOptionalInteger(
    body.children === undefined || body.children === '' ? undefined : Number(body.children),
    'Children',
    0,
    20,
    0,
  );
  if (!childrenResult.ok) return res.status(400).json({ message: childrenResult.message });

  const infantsResult = validateOptionalInteger(
    body.infants === undefined || body.infants === '' ? undefined : Number(body.infants),
    'Infants',
    0,
    10,
    0,
  );
  if (!infantsResult.ok) return res.status(400).json({ message: infantsResult.message });

  // Optional string fields with length caps
  const propertyNameResult = validateOptionalString(body.propertyName, 'Property name', 120);
  if (!propertyNameResult.ok) return res.status(400).json({ message: propertyNameResult.message });

  const discountReasonResult = validateOptionalString(body.discountReason, 'Discount reason', 80);
  if (!discountReasonResult.ok) return res.status(400).json({ message: discountReasonResult.message });

  const specialRequestsResult = validateOptionalString(body.specialRequests, 'Special requests', 500);
  if (!specialRequestsResult.ok) return res.status(400).json({ message: specialRequestsResult.message });

  const promoCodeResult = validateOptionalString(body.promoCode, 'Promo code', 50);
  if (!promoCodeResult.ok) return res.status(400).json({ message: promoCodeResult.message });

  // Discount amount: non-negative, capped (server always recalculates, but reject clear garbage)
  const rawDiscountAmount = body.discountAmount === undefined || body.discountAmount === ''
    ? undefined
    : Number(body.discountAmount);
  const discountAmountResult = validatePositiveNumber(rawDiscountAmount, 'Discount amount', 1_000_000);
  if (!discountAmountResult.ok) return res.status(400).json({ message: discountAmountResult.message });

  // ── Database operations ───────────────────────────────────────────────────

  console.log(`[MongoDB Query] Collection: rooms, Action: findById, ID: ${propertyIdResult.value}`);
  const property = await PropertyModel.findById(propertyIdResult.value).lean();
  console.log(`[MongoDB Results] Collection: rooms, Action: findById, Found: ${property ? 1 : 0}`);

  if (!property) {
    return res.status(404).json({ message: 'Room not found.' });
  }

  let pricing;

  try {
    pricing = calculateBookingPricing({
      propertyPrice: property.price_per_night,
      checkInDate: checkInResult.value,
      checkOutDate: checkOutResult.value,
      adults: adultsResult.value,
      children: childrenResult.value,
      infants: infantsResult.value,
      roomType: roomTypeResult.value as never,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid booking dates.';
    return res.status(400).json({ message });
  }

  try {
    if (await hasBookingOverlap(propertyIdResult.value, checkInResult.value, checkOutResult.value)) {
      return res.status(409).json({ message: 'The requested dates are not available.' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify availability.';
    return res.status(400).json({ message });
  }

  const createdAt = new Date();
  const canonicalDiscountReason = normalizeDiscountReason(discountReasonResult.value ?? undefined);
  const eligibilityDiscount = resolveServerDiscount(
    canonicalDiscountReason,
    pricing.totalPrice,
    discountAmountResult.value,
  );

  let promoDiscount = 0;
  let promoCode = '';
  try {
    const promo = await resolvePromoDiscount(promoCodeResult.value ?? undefined, pricing.totalPrice);
    promoDiscount = promo.discountAmount;
    promoCode = promo.code;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid promo code.';
    return res.status(400).json({ message });
  }

  // Apply the larger of PWD/senior vs promo (do not stack arbitrarily beyond the subtotal).
  const resolvedDiscount = Math.min(pricing.totalPrice, Math.max(eligibilityDiscount, promoDiscount));
  const finalDiscountReason = promoDiscount >= eligibilityDiscount && promoCode
    ? `promo:${promoCode}`
    : (canonicalDiscountReason ?? '');
  const finalTotalPrice = Math.max(0, pricing.totalPrice - resolvedDiscount);

  // Shared MongoDB with the hotel management app:
  // - This website only INSERTS a reservation request (never deletes hotel/ops data).
  // - Do NOT write check_in_date/check_out_date here — that makes the hotel app treat
  //   the request as a room hold and blocks Online Booking approval (self-overlap).
  // - Stay Dates for the hotel queue live on external_reservations only until approval.
  const hotelAppFields = buildHotelAppBookingFields({
    guestName: guestNameResult.value,
    guestEmail: guestEmailResult.value,
    checkInDate: checkInResult.value,
    checkOutDate: checkOutResult.value,
    paymentMethod: paymentMethodResult.value,
    now: createdAt,
    includeStayDates: false,
  });

  const stayDatesForQueue = {
    checkInDate: toStayDate(checkInResult.value),
    checkOutDate: toStayDate(checkOutResult.value),
  };

  const { halfPayment, balanceDue } = computeHalfPayment(finalTotalPrice);
  // Hotel app statuses are unpaid | partial | paid (not "pending").
  // Website collects 50% now; remaining balance is paid at hotel check-out.
  if (finalTotalPrice > 0 && halfPayment >= finalTotalPrice) {
    console.error('[Bookings] Half payment must be less than stay total', { finalTotalPrice, halfPayment });
  }

  const bookingDoc = {
    booking_reference: `BR-${Date.now()}`,
    hotel_id: String(property.hotel_id ?? ''),
    room_id: property._id,
    propertyId: propertyIdResult.value,
    propertyName: propertyNameResult.value ?? property.display_name,
    guestName: guestNameResult.value,
    guestEmail: guestEmailResult.value,
    guest_phone: guestPhoneResult.value,
    ...hotelAppFields,
    discount_reason: finalDiscountReason,
    discount_amount: resolvedDiscount,
    special_requests: specialRequestsResult.ok ? (specialRequestsResult.value ?? '') : '',
    promo_code: promoCode,
    valid_id_filename: validIdFile.originalname.slice(0, 200),
    valid_id_mime: validIdFile.mimetype,
    valid_id_size: validIdFile.size,
    valid_id_base64: validIdFile.buffer.toString('base64'),
    valid_id_uploaded_at: createdAt,
    hotel_ledger_synced: false,
    hotel_queue_synced: false,
    hotel_sync_error: '',
    checkInDate: checkInResult.value,
    checkOutDate: checkOutResult.value,
    adults: adultsResult.value,
    children: childrenResult.value,
    infants: infantsResult.value,
    roomType: roomTypeResult.value,
    paymentMethod: paymentMethodResult.value,
    source: 'web',
    nights: pricing.nights,
    guestCount: pricing.guestCount,
    roomRate: pricing.roomRate,
    serviceFee: 0,
    totalPrice: finalTotalPrice,
    total_amount: finalTotalPrice,
    // Half deposit only — never mark as fully paid on website create.
    amountPaid: halfPayment,
    amount_paid: halfPayment,
    deposit_amount: halfPayment,
    balance_due: balanceDue,
    payment_status: 'partial',
    // 'requested' = website Online Booking awaiting hotel approval.
    // Avoid 'pending' — hotel app treats pending bookings as inventory holds.
    status: 'requested',
    requestedAt: createdAt.toISOString(),
    confirmationSendStatus: 'none' as const,
    confirmationSentAt: null as null,
    confirmationSendError: '',
  };

  const propertyIdValue = propertyIdResult.value;
  const checkInValue = checkInResult.value;
  const checkOutValue = checkOutResult.value;

  async function persistBooking(session: mongoose.ClientSession | null) {
    if (session) {
      if (await hasBookingOverlap(propertyIdValue, checkInValue, checkOutValue, undefined, session)) {
        const conflict = new Error('The requested dates are not available.');
        (conflict as Error & { status: number }).status = 409;
        throw conflict;
      }
      const created = await BookingModel.create([bookingDoc], { session });
      const booking = created?.[0];
      if (!booking) {
        throw new Error('Unable to create booking.');
      }
      if (promoCode) {
        await incrementPromoUse(promoCode, session);
      }
      return booking;
    }

    if (await hasBookingOverlap(propertyIdValue, checkInValue, checkOutValue)) {
      const conflict = new Error('The requested dates are not available.');
      (conflict as Error & { status: number }).status = 409;
      throw conflict;
    }
    const booking = await BookingModel.create(bookingDoc);
    if (promoCode) {
      await incrementPromoUse(promoCode);
    }
    return booking;
  }

  let booking;
  let session: mongoose.ClientSession | null = null;
  try {
    try {
      session = await mongoose.startSession();
    } catch (startError) {
      console.warn('[Bookings] Unable to start Mongo session; using non-transactional create.', startError);
      session = null;
    }

    if (session) {
      try {
        session.startTransaction();
        booking = await persistBooking(session);
        await session.commitTransaction();
      } catch (txError) {
        try {
          await session.abortTransaction();
        } catch {
          // ignore abort failures
        }

        if (isTransactionUnsupported(txError)) {
          console.warn('[Bookings] Transactions unsupported; falling back to non-transactional create.');
          booking = await persistBooking(null);
        } else {
          throw txError;
        }
      }
    } else {
      booking = await persistBooking(null);
    }
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400;
    const message = error instanceof Error ? error.message : 'Unable to create booking.';
    return res.status(status).json({ message });
  } finally {
    if (session) {
      session.endSession();
    }
  }

  console.log(`[MongoDB Action] Collection: bookings, Action: create, Success: true, ID: ${booking._id}`);

  const hotelId = String(booking.hotel_id ?? property.hotel_id ?? '');
  const bookingId = String(booking._id);
  const roomId = String(booking.room_id ?? property._id);
  const paymentMethod = paymentMethodResult.value;
  const syncErrors: string[] = [];

  // Do NOT write billing_charges yet. A room charge is treated as an inventory hold
  // by the hotel app and blocks Online Booking approval (self-overlap).
  // Deposit preference is stored on the booking + external_reservations metadata;
  // ledger rows are written after hotel approval (see hotelBookingSync).
  try {
    await BookingModel.updateOne(
      { _id: booking._id },
      {
        $set: {
          payment_status: 'partial',
          amountPaid: halfPayment,
          amount_paid: halfPayment,
          deposit_amount: halfPayment,
          balance_due: balanceDue,
          total_amount: finalTotalPrice,
          totalPrice: finalTotalPrice,
          serviceFee: 0,
          hotel_ledger_synced: false,
        },
      },
    );
  } catch (billingError) {
    const msg = billingError instanceof Error ? billingError.message : String(billingError);
    syncErrors.push(`ledger-fields:${msg}`);
    console.error('[Bookings] Failed to persist half-payment preference fields:', billingError);
  }

  // Hotel app "Online Bookings" is driven by external_reservations (pending_approval).
  try {
    await withRetries(async () => {
      const existing = await ExternalReservationModel.countDocuments({
        booking_id: bookingId,
        external_reference: String(booking.booking_reference),
      });
      if (existing > 0) return;

      const externalDoc = buildExternalReservationDoc({
        hotelId,
        bookingId,
        bookingReference: String(booking.booking_reference),
        guestName: guestNameResult.value,
        guestEmail: guestEmailResult.value,
        guestPhone: guestPhoneResult.value,
        checkInDate: stayDatesForQueue.checkInDate,
        checkOutDate: stayDatesForQueue.checkOutDate,
        roomId,
        paymentMethod,
        totalAmount: finalTotalPrice,
        halfPayment,
        balanceDue,
        nights: pricing.nights,
        adults: adultsResult.value,
        children: childrenResult.value,
        now: createdAt,
        validIdUploaded: true,
        validIdFilename: validIdFile.originalname.slice(0, 200),
      });
      await ExternalReservationModel.create(externalDoc);
    }, { attempts: 3, delayMs: 300, label: 'external_reservations Online Bookings row' });

    await BookingModel.updateOne(
      { _id: booking._id },
      { $set: { hotel_queue_synced: true } },
    );
    console.log(`[MongoDB Action] Collection: external_reservations, Action: create, Success: true, Ref: ${booking.booking_reference}`);
  } catch (externalError) {
    const msg = externalError instanceof Error ? externalError.message : String(externalError);
    syncErrors.push(`queue:${msg}`);
    console.error('[Bookings] Failed to create external_reservations Online Bookings row after retries:', externalError);
  }

  if (syncErrors.length > 0) {
    await BookingModel.updateOne(
      { _id: booking._id },
      { $set: { hotel_sync_error: syncErrors.join(' | ').slice(0, 500) } },
    );
  }

  // Guest lifecycle email #1: request received (do not fail the booking if email fails).
  try {
    const fresh = await BookingModel.findById(booking._id);
    if (fresh) {
      await sendBookingRequestReceivedNotification(fresh);
    }
  } catch (emailError) {
    console.error('[Bookings] Failed to send request-received email:', emailError);
  }

  const receiptToken = signReceiptToken(String(booking._id), guestEmailResult.value);
  return res.status(201).json({
    ...serializeBooking(booking as never),
    amountPaid: halfPayment,
    balanceDue,
    paymentStatus: 'partial',
    validIdUploaded: true,
    hotelLedgerSynced: syncErrors.every((e) => !e.startsWith('ledger:')),
    hotelQueueSynced: syncErrors.every((e) => !e.startsWith('queue:')),
    receiptToken,
  });
});

// ─── POST /:bookingId/review-availability ─────────────────────────────────────
// requireAuth + admin/staff/super_admin only — this is an internal hotel-ops action.

bookingRoutes.post('/:bookingId/review-availability', requireAuth, async (req, res) => {
  // Only privileged staff may trigger a server-side availability review.
  if (!req.auth || !isPrivilegedRole(req.auth.role as UserRole)) {
    return res.status(403).json({ message: 'Access denied. Staff access required.' });
  }

  // OWASP A03: validate bookingId param length
  const bookingIdResult = validateId(req.params.bookingId, 'Booking ID');
  if (!bookingIdResult.ok) {
    return res.status(400).json({ message: bookingIdResult.message });
  }

  console.log(`[MongoDB Query] Collection: bookings, Action: findById, ID: ${bookingIdResult.value}`);
  const booking = await BookingModel.findById(bookingIdResult.value);
  console.log(`[MongoDB Results] Collection: bookings, Action: findById, Found: ${booking ? 1 : 0}`);

  if (!booking) {
    return res.status(404).json({ message: 'Booking not found.' });
  }

  if (booking.status !== 'requested' && booking.status !== 'pending') {
    return res.status(409).json({ message: 'Only requested/pending bookings can be reviewed for availability.' });
  }

  if (!booking.propertyId) {
    return res.status(400).json({ message: 'Booking is missing a property reference.' });
  }

  try {
    const checkInForOverlap = String(
      booking.checkInDate
        ?? (booking.check_in_date ? new Date(booking.check_in_date).toISOString().slice(0, 10) : ''),
    );
    const checkOutForOverlap = String(
      booking.checkOutDate
        ?? (booking.check_out_date ? new Date(booking.check_out_date).toISOString().slice(0, 10) : ''),
    );
    if (!checkInForOverlap || !checkOutForOverlap) {
      return res.status(400).json({ message: 'Booking is missing check-in/check-out dates.' });
    }

    const overlap = await hasBookingOverlap(
      booking.propertyId,
      checkInForOverlap,
      checkOutForOverlap,
      String(booking._id),
    );

    booking.status = overlap ? 'declined' : 'accepted';
    if (typeof booking.summary_only !== 'boolean') {
      booking.summary_only = false;
    }
    console.log(`[MongoDB Action] Collection: bookings, Action: save (update status), ID: ${booking._id}, New Status: ${booking.status}`);
    await booking.save();

    if (booking.status === 'declined') {
      await sendBookingDeclinedNotification(booking).catch((err) => {
        console.error('[Bookings] Decline email failed after availability review:', err);
      });
    }

    return res.json({
      booking: serializeBooking(booking.toObject() as never),
      available: !overlap,
      message: overlap
        ? 'The requested dates overlap with an existing booking.'
        : 'No overlapping bookings found; property appears available.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to review availability.';
    return res.status(400).json({ message });
  }
});

// ─── PUT /:bookingId ──────────────────────────────────────────────────────────
// requireAuth: both guests (own booking status transitions) and privileged staff may update.

bookingRoutes.put('/:bookingId', requireAuth, async (req, res) => {
  // OWASP A03: validate bookingId param length
  const bookingIdResult = validateId(req.params.bookingId, 'Booking ID');
  if (!bookingIdResult.ok) {
    return res.status(400).json({ message: bookingIdResult.message });
  }

  console.log(`[MongoDB Query] Collection: bookings, Action: findById, ID: ${bookingIdResult.value}`);
  const booking = await BookingModel.findById(bookingIdResult.value);
  console.log(`[MongoDB Results] Collection: bookings, Action: findById, Found: ${booking ? 1 : 0}`);

  if (!booking) {
    return res.status(404).json({ message: 'Booking not found.' });
  }

  // ── Ownership / privilege check ───────────────────────────────────────────
  // Guests may only update their own booking.
  // Privileged staff may update bookings for their hotel only (super_admin: any).
  const requester = await getRequestUser(req);
  if (!requester) {
    return res.status(401).json({ message: 'Authenticated user not found.' });
  }
  const callerRole = requester.role as UserRole;
  const isStaff = isPrivilegedRole(callerRole);
  const isOwner = booking.guestEmail?.toLowerCase() === requester.email;

  if (!isStaff && !isOwner) {
    return res.status(403).json({ message: 'Access denied. You may only update your own bookings.' });
  }
  if (isStaff && !staffCanAccessBooking(callerRole, requester.hotelId, booking.hotel_id)) {
    return res.status(403).json({ message: 'Access denied. Booking belongs to another hotel.' });
  }

  // Non-privileged guests may only make allowed status transitions.
  if (!isStaff && req.body.status) {
    const allowedTransitions = GUEST_STATUS_TRANSITIONS[booking.status as BookingStatus] ?? [];
    if (!allowedTransitions.includes(req.body.status as BookingStatus)) {
      return res.status(403).json({
        message: `Guests may not set booking status to '${req.body.status as string}'.`,
      });
    }
  }

  // OWASP A03: strip unexpected body fields; validate enums against explicit allowlists
  const body = pickFields(req.body, ['status', 'paymentMethod'] as const);

  // Validate status if provided — must be from the allowed enum
  const statusResult = validateOptionalEnum(body.status, 'Status', BOOKING_STATUS_VALUES);
  if (!statusResult.ok) return res.status(400).json({ message: statusResult.message });

  // Validate paymentMethod if provided — accept any string for now
  const paymentMethodResult = validateOptionalString(body.paymentMethod, 'Payment method', 100);
  if (!paymentMethodResult.ok) return res.status(400).json({ message: paymentMethodResult.message });

  const previousStatus = booking.status;

  if (statusResult.value) {
    booking.status = statusResult.value;
  }

  if (paymentMethodResult.value) {
    booking.paymentMethod = paymentMethodResult.value;
  }

  if (statusResult.value === 'confirmed' && previousStatus !== 'confirmed') {
    await sendBookingConfirmationNotification(booking);
  }
  if (
    (statusResult.value === 'declined' || statusResult.value === 'cancelled')
    && previousStatus !== statusResult.value
    && !['declined', 'cancelled'].includes(String(previousStatus))
  ) {
    await sendBookingDeclinedNotification(booking);
  }

  // Heal missing hotel-app required boolean so saves/reports don't fail validation.
  if (typeof booking.summary_only !== 'boolean') {
    booking.summary_only = false;
  }

  console.log(`[MongoDB Action] Collection: bookings, Action: save, ID: ${booking._id}`);
  await booking.save();
  return res.json(serializeBooking(booking.toObject() as never));
});

// ─── POST /:bookingId/retry-confirmation ──────────────────────────────────────
// requireAuth + admin/staff/super_admin only — privileged staff action.

bookingRoutes.post('/:bookingId/retry-confirmation', requireAuth, async (req, res) => {
  const requester = await getRequestUser(req);
  if (!requester || !isPrivilegedRole(requester.role as UserRole)) {
    return res.status(403).json({ message: 'Access denied. Staff access required.' });
  }

  const bookingIdResult = validateId(req.params.bookingId, 'Booking ID');
  if (!bookingIdResult.ok) {
    return res.status(400).json({ message: bookingIdResult.message });
  }

  const booking = await BookingModel.findById(bookingIdResult.value);
  if (!booking) {
    return res.status(404).json({ message: 'Booking not found.' });
  }
  if (!staffCanAccessBooking(requester.role as UserRole, requester.hotelId, booking.hotel_id)) {
    return res.status(403).json({ message: 'Access denied. Booking belongs to another hotel.' });
  }

  await sendBookingConfirmationNotification(booking);
  await booking.save();
  return res.json(serializeBooking(booking.toObject() as never));
});

// ─── DELETE /:bookingId ────────────────────────────────────────────────────────
// requireAuth: guests may cancel their own bookings; privileged staff may cancel any.

bookingRoutes.delete('/:bookingId', requireAuth, async (req, res) => {
  const bookingIdResult = validateId(req.params.bookingId, 'Booking ID');
  if (!bookingIdResult.ok) return res.status(400).json({ message: bookingIdResult.message });

  const booking = await BookingModel.findById(bookingIdResult.value);
  if (!booking) return res.status(404).json({ message: 'Booking not found.' });

  // ── Ownership / privilege check ───────────────────────────────────────────
  const requester = await getRequestUser(req);
  if (!requester) {
    return res.status(401).json({ message: 'Authenticated user not found.' });
  }
  const callerRole = requester.role as UserRole;
  const isStaff = isPrivilegedRole(callerRole);
  const ownerEmail = String(booking.guestEmail ?? booking.guest_email ?? '').toLowerCase();
  const isOwner = Boolean(ownerEmail) && ownerEmail === requester.email;

  if (!isStaff && !isOwner) {
    return res.status(403).json({ message: 'Access denied. You may only cancel your own bookings.' });
  }
  if (isStaff && !staffCanAccessBooking(callerRole, requester.hotelId, booking.hotel_id)) {
    return res.status(403).json({ message: 'Access denied. Booking belongs to another hotel.' });
  }

  const cancellableStatuses = ['requested', 'accepted', 'pending'];
  if (!cancellableStatuses.includes(booking.status)) {
    return res.status(409).json({ message: `Cannot cancel a booking with status '${booking.status}'.` });
  }

  // Hotel app lists typically hide `cancelled` (not only `declined`).
  booking.status = 'cancelled';
  if (typeof booking.summary_only !== 'boolean') {
    booking.summary_only = false;
  }
  await booking.save();

  // Keep Online Bookings queue in sync when a website request is cancelled.
  try {
    await ExternalReservationModel.updateMany(
      {
        $or: [
          { booking_id: String(booking._id) },
          { external_reference: booking.booking_reference },
        ],
        status: { $in: ['pending_approval', 'approved', 'reserved'] },
      },
      { $set: { status: 'rejected', updated_at: new Date() } },
    );
  } catch (externalError) {
    console.error('[Bookings] Failed to sync external_reservations on cancel:', externalError);
  }

  return res.json(serializeBooking(booking.toObject() as never));
});

// ─── POST /:bookingId/payment-checkout ────────────────────────────────────────
// Creates a real Xendit invoice when XENDIT_SECRET_KEY is configured.
// Otherwise returns a clear "unavailable" payload so the UI never fakes payment.

bookingRoutes.post('/:bookingId/payment-checkout', optionalAuth, async (req, res) => {
  const bookingIdResult = validateId(req.params.bookingId, 'Booking ID');
  if (!bookingIdResult.ok) return res.status(400).json({ message: bookingIdResult.message });

  const booking = await BookingModel.findById(bookingIdResult.value);
  if (!booking) return res.status(404).json({ message: 'Booking not found.' });

  const bookingEmail = String(booking.guestEmail ?? '').toLowerCase();
  const requester = req.auth ? await getRequestUser(req) : null;
  const isStaff = Boolean(requester && isPrivilegedRole(requester.role as UserRole));
  const isOwner = Boolean(requester && requester.email === bookingEmail);

  let tokenOk = false;
  const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (rawToken) {
    try {
      const payload = verifyReceiptToken(rawToken);
      tokenOk = payload.bookingId === bookingIdResult.value && payload.email === bookingEmail;
    } catch {
      tokenOk = false;
    }
  }

  if (!isStaff && !isOwner && !tokenOk) {
    return res.status(403).json({ message: 'Access denied. Sign in or provide a valid receipt token to start payment.' });
  }
  if (
    isStaff
    && requester
    && !staffCanAccessBooking(requester.role as UserRole, requester.hotelId, booking.hotel_id)
  ) {
    return res.status(403).json({ message: 'Access denied. Booking belongs to another hotel.' });
  }

  if (['declined', 'cancelled'].includes(String(booking.status))) {
    return res.status(409).json({ message: 'Cannot collect payment for a cancelled booking.' });
  }

  const frontendOrigin = CLIENT_ORIGINS[0] ?? 'http://localhost:3000';
  const successRedirectUrl = `${frontendOrigin}/booking/confirm/${bookingIdResult.value}?email=${encodeURIComponent(bookingEmail)}&paid=1`;
  const failureRedirectUrl = `${frontendOrigin}/booking/confirm/${bookingIdResult.value}?email=${encodeURIComponent(bookingEmail)}&paid=0`;

  const checkoutTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const recordedHalf = Number(booking.amount_paid ?? booking.deposit_amount ?? booking.amountPaid ?? 0);
  const { halfPayment } = computeHalfPayment(checkoutTotal);
  // Collect the half deposit only — never invoice the full stay on website checkout.
  const checkoutAmount = recordedHalf > 0 && recordedHalf < checkoutTotal
    ? recordedHalf
    : halfPayment;

  try {
    const checkout = await createPaymentCheckout({
      bookingId: bookingIdResult.value,
      bookingReference: String(booking.booking_reference ?? ''),
      amount: checkoutAmount,
      guestEmail: bookingEmail,
      guestName: String(booking.guestName ?? 'Guest'),
      description: `Madyaw 50% deposit ${booking.booking_reference ?? bookingIdResult.value}`,
      successRedirectUrl,
      failureRedirectUrl,
    });

    return res.json(checkout);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create payment checkout.';
    return res.status(502).json({ message });
  }
});

// ─── GET /:bookingId/receipt ───────────────────────────────────────────────────
// optionalAuth: logged-in users get ownership check; guest-checkout users provide
// a signed receipt token (preferred) or their email (legacy compatibility).

bookingRoutes.get('/:bookingId/receipt', optionalAuth, async (req, res) => {
  const bookingIdResult = validateId(req.params.bookingId, 'Booking ID');
  if (!bookingIdResult.ok) return res.status(400).json({ message: bookingIdResult.message });

  const booking = await BookingModel.findById(bookingIdResult.value).lean();
  if (!booking) return res.status(404).json({ message: 'Booking not found.' });

  // Privileged staff: only their hotel (super_admin: any).
  if (req.auth && isPrivilegedRole(req.auth.role)) {
    const requester = await getRequestUser(req);
    if (!requester) {
      return res.status(401).json({ message: 'Authenticated user not found.' });
    }
    if (!staffCanAccessBooking(requester.role as UserRole, requester.hotelId, booking.hotel_id)) {
      return res.status(403).json({ message: 'Access denied. Booking belongs to another hotel.' });
    }
    return res.json(serializeBooking(booking as never));
  }

  // Authenticated guest: must own the booking.
  if (req.auth) {
    const callerEmail = req.auth.email.toLowerCase();
    const bookingEmail = (booking.guestEmail as string | undefined)?.toLowerCase() ?? '';
    if (callerEmail !== bookingEmail) {
      return res.status(403).json({ message: 'Access denied. This receipt belongs to a different account.' });
    }
    return res.json(serializeBooking(booking as never));
  }

  // Preferred guest-checkout proof: signed receipt token issued at create time.
  const rawToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!rawToken) {
    return res.status(401).json({
      message: 'Authentication required. Please open your confirmation link with a valid receipt token.',
    });
  }

  try {
    const payload = verifyReceiptToken(rawToken);
    const bookingEmail = (booking.guestEmail as string | undefined)?.toLowerCase() ?? '';
    if (payload.bookingId !== bookingIdResult.value || payload.email !== bookingEmail) {
      return res.status(403).json({ message: 'Access denied. Invalid receipt token for this booking.' });
    }
    return res.json(serializeBooking(booking as never));
  } catch {
    return res.status(401).json({ message: 'Invalid or expired receipt token.' });
  }
});

export default bookingRoutes;
