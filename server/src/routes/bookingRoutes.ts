import { Router, type Request } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { BookingModel, ExternalReservationModel, HotelModel, PropertyModel, UserModel, BookingValidIdModel } from '../data/mongoModels';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { availabilityLimiter, bookingCreateLimiter, hotelWebhookLimiter } from '../middleware/rateLimiters';
import { isPrivilegedRole } from '../middleware/rbac';
import { calculateBookingPricing } from '../utils/pricing';
import { serializeBooking } from '../utils/serialize';
import { sendBookingConfirmationNotification, sendBookingRequestReceivedNotification, sendBookingDeclinedNotification, queueGuestNotification } from '../services/notificationService';
import { createPaymentCheckout } from '../services/paymentService';
import { applyHotelBookingDecision } from '../services/hotelBookingSync';
import { resolvePromoDiscount, incrementPromoUse } from '../utils/promo';
import { resolveMemberDiscount } from '../utils/memberDiscount';
import { signReceiptToken, verifyReceiptToken } from '../utils/receiptToken';
import { buildHotelAppBookingFields, toStayDate } from '../utils/hotelAppBookingFields';
import { coerceSummaryOnly, toHotelRoomId } from '../utils/bookingHotelFields';
import { buildExternalReservationDoc } from '../utils/externalReservation';
import {
  computeOnlinePaymentDue,
  resolveHotelOnlinePaymentMode,
  resolveOnlinePaymentModeFromBooking,
} from '../utils/halfPayment';
import { withRetries } from '../utils/withRetries';
import { syncPaymentProofToHotelApp, finalizeDepositAfterHotelVerification } from '../utils/syncPaymentProofToHotel';
import { runBookingUploads, type UploadedBookingFile } from '../middleware/validIdUpload';
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
import { USER_MESSAGES } from '../utils/userMessages';

const bookingRoutes = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = 'guest' | 'partner' | 'admin' | 'staff' | 'super_admin';
type BookingStatus = 'requested' | 'accepted' | 'declined' | 'paid' | 'confirmed' | 'pending' | 'cancelled';

const ACTIVE_BOOKING_STATUSES = ['requested', 'accepted', 'paid', 'confirmed', 'pending', 'reserved', 'booked'] as const;

// Allowlists — validated server-side, never taken verbatim from client input (OWASP A03)
const ROOM_TYPE_VALUES = ['standard-room', 'deluxe-suite', 'family-suite', 'villa-retreat'] as const;
const PAYMENT_METHOD_VALUES = ['credit-card', 'debit-card', 'gcash', 'maya', 'qrph', 'bank-transfer'] as const;
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
  if (normalized === 'qr ph' || normalized === 'qr-ph' || normalized === 'qr_ph') return 'qrph';
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
    return res.status(401).json({ message: USER_MESSAGES.accountNotFound });
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
    return res.status(400).json({ message: USER_MESSAGES.selectDatesAndRoom });
  }

  // OWASP A03: validate propertyId length before passing to DB query
  const idResult = validateId(propertyId, 'Room');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }

  // Validate date strings are parseable ISO dates
  if (Number.isNaN(new Date(checkInDate).getTime()) || Number.isNaN(new Date(checkOutDate).getTime())) {
    return res.status(400).json({ message: USER_MESSAGES.invalidDates });
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
      message: USER_MESSAGES.serviceUnavailable,
    });
  }
  if (!isHotelWebhookAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized request.' });
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

  // Hotel verified the guest deposit screenshot in MADYAWPH.
  const statusLower = status.toLowerCase();
  if (
    statusLower === 'payment.verified'
    || statusLower === 'deposit.verified'
    || statusLower === 'payment_proof_verified'
    || statusLower.endsWith('.payment_verified')
  ) {
    let id = bookingId;
    if (!id && bookingReference) {
      const found = await BookingModel.findOne({ booking_reference: bookingReference }).select('_id').lean();
      id = found?._id ? String(found._id) : undefined;
    }
    if (!id) {
      return res.status(404).json({ message: 'No matching website booking found.' });
    }
    await BookingModel.updateOne(
      { _id: id },
      { $set: { payment_proof_verified: true, payment_proof_verified_at: new Date() } },
    );
    const finalized = await finalizeDepositAfterHotelVerification(id);
    return res.json({
      ok: true,
      kind: 'payment_verified',
      bookingId: id,
      finalized,
      message: finalized
        ? 'Deposit recorded after hotel verification.'
        : 'Verification flagged; deposit ledger may already be synced.',
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
  let validIdFile: UploadedBookingFile | undefined;
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType.includes('multipart/form-data')) {
    try {
      const uploads = await runBookingUploads(req, res);
      validIdFile = uploads.validId;
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'File upload failed.';
      const isSize = /File too large|LIMIT_FILE_SIZE/i.test(message);
      return res.status(400).json({
        message: isSize ? 'Each upload must be 5 MB or smaller.' : message,
      });
    }
  }

  if (!validIdFile) {
    return res.status(400).json({ message: 'Please upload a valid ID (JPG, PNG, WEBP, or PDF, max 5 MB).' });
  }

  // Payment proof is collected AFTER hotel confirmation (pay-deposit link).
  // Ignore any proof attached at create so guests never pay before approval.

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
    'membershipId',
    'memberShidId',
    'paymentTransactionRef',
    'paymentProofAmountClaimed',
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

  const membershipIdResult = validateOptionalString(
    body.membershipId ?? body.memberShidId,
    'Membership ID',
    40,
  );
  if (!membershipIdResult.ok) return res.status(400).json({ message: membershipIdResult.message });

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

  const hotelIdForPolicy = String(property.hotel_id ?? '');
  const hotelDoc = hotelIdForPolicy
    ? await HotelModel.findById(hotelIdForPolicy).lean()
    : null;
  // Wallet QR payments always collect half first; card methods follow the hotel setting.
  const walletQrMethod = ['gcash', 'maya', 'qrph', 'bank-transfer'].includes(paymentMethodResult.value);
  const paymentMode = walletQrMethod ? 'half' : resolveHotelOnlinePaymentMode(hotelDoc);

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

  let memberDiscount = 0;
  let membershipId = '';
  let memberDiscountPercent = 0;
  const rawMembershipId = membershipIdResult.value?.trim() ?? '';
  if (rawMembershipId) {
    const member = await resolveMemberDiscount(rawMembershipId, pricing.totalPrice);
    if (!member.valid) {
      return res.status(400).json({ message: member.message || 'Invalid membership ID.' });
    }
    memberDiscount = member.discountAmount;
    membershipId = member.membershipId;
    memberDiscountPercent = member.discountPercent;
  }

  // Apply the largest single discount among PWD/senior, promo, and Madyaw member.
  const resolvedDiscount = Math.min(
    pricing.totalPrice,
    Math.max(eligibilityDiscount, promoDiscount, memberDiscount),
  );
  let finalDiscountReason = canonicalDiscountReason ?? '';
  let finalDiscountType = canonicalDiscountReason ?? '';
  let finalDiscountValue = canonicalDiscountReason ? 20 : 0;
  if (memberDiscount >= eligibilityDiscount && memberDiscount >= promoDiscount && membershipId) {
    finalDiscountReason = 'madyaw member';
    finalDiscountType = 'member';
    finalDiscountValue = memberDiscountPercent;
  } else if (promoDiscount >= eligibilityDiscount && promoCode) {
    finalDiscountReason = `promo:${promoCode}`;
    finalDiscountType = 'promo';
    finalDiscountValue = 0;
  }
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

  const { amountDue, balanceDue, depositPercent, mode: onlinePaymentMode } =
    computeOnlinePaymentDue(finalTotalPrice, paymentMode);
  // Deposit is collected after hotel confirmation — create as unpaid.
  const paymentStatus = 'unpaid' as const;
  if (onlinePaymentMode === 'half' && finalTotalPrice > 0 && amountDue >= finalTotalPrice) {
    console.error('[Bookings] Half payment must be less than stay total', { finalTotalPrice, amountDue });
  }

  const bookingDoc = {
    booking_reference: `BR-${Date.now()}`,
    hotel_id: String(property.hotel_id ?? ''),
    room_id: toHotelRoomId(property._id),
    propertyId: propertyIdResult.value,
    propertyName: propertyNameResult.value ?? property.display_name,
    guestName: guestNameResult.value,
    guestEmail: guestEmailResult.value,
    guest_phone: guestPhoneResult.value,
    ...hotelAppFields,
    discount_reason: finalDiscountReason,
    discount_type: finalDiscountType,
    discount_value: finalDiscountValue,
    discount_amount: resolvedDiscount,
    member_shid_id: membershipId,
    special_requests: specialRequestsResult.ok ? (specialRequestsResult.value ?? '') : '',
    promo_code: promoCode,
    valid_id_filename: validIdFile.originalname.slice(0, 200),
    valid_id_mime: validIdFile.mimetype,
    valid_id_size: validIdFile.size,
    valid_id_stored: true,
    valid_id_uploaded_at: createdAt,
    payment_proof_filename: '',
    payment_proof_stored: false,
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
    // Unpaid until guest pays after hotel confirmation.
    amountPaid: 0,
    amount_paid: 0,
    deposit_amount: amountDue,
    balance_due: finalTotalPrice,
    online_payment_mode: onlinePaymentMode,
    deposit_percent: depositPercent,
    payment_status: paymentStatus,
    // Hotel-native awaiting status is "pending". Do NOT write check_in_date/check_out_date
    // on create (those are what make the hotel app treat this as an inventory hold).
    // Online Bookings queue is driven by external_reservations (pending_approval).
    status: 'pending',
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

  // Store Valid ID binary off the booking document so hotel list/login queries stay lean.
  try {
    await withRetries(async () => {
      await BookingValidIdModel.findOneAndUpdate(
        { booking_id: String(booking._id) },
        {
          $set: {
            booking_id: String(booking._id),
            booking_reference: String(booking.booking_reference),
            hotel_id: String(booking.hotel_id ?? property.hotel_id ?? ''),
            filename: validIdFile.originalname.slice(0, 200),
            mime: validIdFile.mimetype,
            size: validIdFile.size,
            base64: validIdFile.buffer.toString('base64'),
            uploaded_at: createdAt,
          },
        },
        { upsert: true, new: true },
      );
    }, { attempts: 3, delayMs: 200, label: 'booking_valid_ids store' });
  } catch (idStoreError) {
    console.error('[Bookings] Failed to store Valid ID in booking_valid_ids:', idStoreError);
  }

  const hotelId = String(booking.hotel_id ?? property.hotel_id ?? '');
  const bookingId = String(booking._id);
  const roomId = String(booking.room_id ?? property._id);
  const paymentMethod = paymentMethodResult.value;
  const syncErrors: string[] = [];

  // Do NOT write billing_charges yet. A room charge is treated as an inventory hold
  // by the hotel app and blocks Online Booking approval (self-overlap).
  // Deposit preference is stored on the booking + external_reservations metadata;
  // ledger rows are written after hotel approval (see hotelBookingSync).

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
        amountDue,
        amountPaid: 0,
        balanceDue: finalTotalPrice,
        onlinePaymentMode,
        depositPercent,
        paymentStatus: 'unpaid',
        nights: pricing.nights,
        adults: adultsResult.value,
        children: childrenResult.value,
        now: createdAt,
        validIdUploaded: true,
        validIdFilename: validIdFile.originalname.slice(0, 200),
        paymentProofUploaded: false,
        paymentProofFilename: undefined,
        paymentProofMime: undefined,
        paymentTransactionRef: undefined,
        paymentProofAmountClaimed: undefined,
        paymentProofExpectedAmount: amountDue,
        paymentProofVerified: false,
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

  // Guest lifecycle email #1: request received (off the request path — Resend can be slow).
  queueGuestNotification('request-received', () => sendBookingRequestReceivedNotification(booking));

  const receiptToken = signReceiptToken(String(booking._id), guestEmailResult.value);
  return res.status(201).json({
    ...serializeBooking(booking as never),
    amountPaid: 0,
    balanceDue: finalTotalPrice,
    depositAmount: amountDue,
    paymentStatus: 'unpaid',
    onlinePaymentMode,
    depositPercent,
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
    booking.summary_only = coerceSummaryOnly(booking.summary_only);
    console.log(`[MongoDB Action] Collection: bookings, Action: save (update status), ID: ${booking._id}, New Status: ${booking.status}`);
    await booking.save();

    if (booking.status === 'declined') {
      queueGuestNotification('decline-after-review', () => sendBookingDeclinedNotification(booking));
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
    return res.status(401).json({ message: USER_MESSAGES.accountNotFound });
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
    queueGuestNotification('confirmation', () => sendBookingConfirmationNotification(booking));
  }
  if (
    (statusResult.value === 'declined' || statusResult.value === 'cancelled')
    && previousStatus !== statusResult.value
    && !['declined', 'cancelled'].includes(String(previousStatus))
  ) {
    queueGuestNotification('decline', () => sendBookingDeclinedNotification(booking));
  }

  // Heal summary_only as 0|1 so hotel-app reports pass Laravel boolean validation.
  booking.summary_only = coerceSummaryOnly(booking.summary_only);

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
    return res.status(401).json({ message: USER_MESSAGES.accountNotFound });
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
  booking.summary_only = coerceSummaryOnly(booking.summary_only);
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

// ─── POST /:bookingId/payment-proof ───────────────────────────────────────────
// Guest uploads deposit proof AFTER hotel confirmation (magic receipt token).

bookingRoutes.post('/:bookingId/payment-proof', bookingCreateLimiter, async (req, res) => {
  const bookingIdResult = validateId(req.params.bookingId, 'Booking ID');
  if (!bookingIdResult.ok) return res.status(400).json({ message: bookingIdResult.message });

  let paymentProofFile: UploadedBookingFile | undefined;
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType.includes('multipart/form-data')) {
    try {
      const uploads = await runBookingUploads(req, res);
      paymentProofFile = uploads.paymentProof;
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'File upload failed.';
      const isSize = /File too large|LIMIT_FILE_SIZE/i.test(message);
      return res.status(400).json({
        message: isSize ? 'Each upload must be 5 MB or smaller.' : message,
      });
    }
  }

  if (!paymentProofFile) {
    return res.status(400).json({
      message: 'Please upload your payment screenshot after paying via the hotel QR.',
    });
  }

  const booking = await BookingModel.findById(bookingIdResult.value);
  if (!booking) return res.status(404).json({ message: 'Booking not found.' });

  const bookingEmail = String(booking.guestEmail ?? '').toLowerCase();
  const rawToken = typeof req.body?.token === 'string'
    ? req.body.token.trim()
    : (typeof req.query?.token === 'string' ? String(req.query.token).trim() : '');

  let tokenOk = false;
  if (rawToken) {
    try {
      const payload = verifyReceiptToken(rawToken);
      tokenOk = payload.bookingId === bookingIdResult.value && payload.email === bookingEmail;
    } catch {
      tokenOk = false;
    }
  }
  if (!tokenOk) {
    return res.status(403).json({
      message: 'Open the Pay deposit link from your confirmation email to upload payment proof.',
    });
  }

  const status = String(booking.status ?? '');
  if (['declined', 'cancelled'].includes(status)) {
    return res.status(409).json({ message: 'Cannot pay for a cancelled booking.' });
  }
  if (!['reserved', 'confirmed', 'booked', 'accepted', 'paid'].includes(status)) {
    return res.status(409).json({
      message: 'Your reservation is still under hotel review. You can pay after the hotel confirms.',
    });
  }

  if (booking.payment_proof_stored || booking.payment_proof_filename) {
    return res.status(409).json({
      message: 'Payment proof was already submitted for this booking.',
    });
  }

  const stayTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const mode = resolveOnlinePaymentModeFromBooking(booking);
  const due = computeOnlinePaymentDue(stayTotal, mode);
  const amountDue = Number(booking.deposit_amount ?? due.amountDue);

  const refRaw = validateString(req.body?.paymentTransactionRef, 'Payment transaction reference', 6, 64);
  if (!refRaw.ok) {
    return res.status(400).json({
      message: 'Enter the GCash/Maya/bank transaction reference from your receipt (at least 6 characters).',
    });
  }
  const normalizedRef = refRaw.value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9\-_/]{5,63}$/i.test(normalizedRef)) {
    return res.status(400).json({
      message: 'Transaction reference looks invalid. Copy it exactly from your wallet receipt.',
    });
  }

  const rawClaimed =
    req.body?.paymentProofAmountClaimed === undefined || req.body?.paymentProofAmountClaimed === ''
      ? amountDue
      : Number(req.body.paymentProofAmountClaimed);
  if (!Number.isFinite(rawClaimed) || rawClaimed <= 0) {
    return res.status(400).json({
      message: 'Enter the amount you paid (must match the deposit due).',
    });
  }
  if (Math.abs(rawClaimed - amountDue) > 1) {
    return res.status(400).json({
      message: `Payment amount must match the deposit due (₱${amountDue.toLocaleString()}).`,
    });
  }

  const paymentProofSha256 = crypto.createHash('sha256').update(paymentProofFile.buffer).digest('hex');
  const reusedProof = await BookingModel.findOne({ payment_proof_sha256: paymentProofSha256 })
    .select('_id')
    .lean();
  if (reusedProof) {
    return res.status(409).json({
      message: 'This payment screenshot was already used on another booking. Upload a new receipt for this stay.',
    });
  }
  const reusedRef = await BookingModel.findOne({ payment_transaction_ref: normalizedRef })
    .select('_id')
    .lean();
  if (reusedRef) {
    return res.status(409).json({
      message: 'This transaction reference was already used on another booking.',
    });
  }

  const now = new Date();
  const paymentProofAmountClaimed = Math.round(rawClaimed * 100) / 100;
  const proofBase64 = paymentProofFile.buffer.toString('base64');
  const proofFilename = paymentProofFile.originalname.slice(0, 200);

  // Store screenshot on the booking for hotel viewers that read inline fields.
  // Do NOT mark amount_paid / payment_status as paid yet — hotel must verify first.
  await BookingModel.updateOne(
    { _id: booking._id },
    {
      $set: {
        payment_proof_filename: proofFilename,
        payment_proof_mime: paymentProofFile.mimetype,
        payment_proof_size: paymentProofFile.size,
        payment_proof_base64: proofBase64,
        payment_proof_stored: true,
        payment_proof_uploaded_at: now,
        payment_transaction_ref: normalizedRef,
        payment_proof_amount_claimed: paymentProofAmountClaimed,
        payment_proof_sha256: paymentProofSha256,
        payment_proof_verified: false,
        payment_proof_verified_at: null,
        // Expected deposit stays on deposit_amount; collected amount stays 0 until verify.
        deposit_amount: amountDue,
        amountPaid: 0,
        amount_paid: 0,
        balance_due: stayTotal,
        payment_status: 'unpaid',
      },
    },
  );

  try {
    await syncPaymentProofToHotelApp({
      bookingId: bookingIdResult.value,
      bookingReference: String(booking.booking_reference ?? ''),
      hotelId: String(booking.hotel_id ?? ''),
      roomId: String(booking.room_id ?? ''),
      filename: proofFilename,
      mime: paymentProofFile.mimetype,
      size: paymentProofFile.size,
      base64: proofBase64,
      transactionRef: normalizedRef,
      amountClaimed: paymentProofAmountClaimed,
      expectedDeposit: amountDue,
      stayTotal,
      nights: Number(booking.nights ?? 1),
      roomRate: Number(booking.roomRate ?? 0),
      paymentMethod: String(booking.paymentMethod ?? booking.payment_method ?? ''),
      uploadedAt: now,
    });
  } catch (proofStoreError) {
    console.error('[Bookings] Failed to sync payment proof to hotel app collections:', proofStoreError);
    return res.status(502).json({
      message: 'Payment screenshot could not be delivered to the hotel app. Please try again.',
    });
  }

  const updated = await BookingModel.findById(bookingIdResult.value).lean();
  return res.json(serializeBooking((updated ?? booking.toObject()) as never));
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
    return res.status(403).json({ message: 'Please sign in or open your booking confirmation link to pay.' });
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
  if (!['reserved', 'confirmed', 'booked', 'accepted', 'paid'].includes(String(booking.status))) {
    return res.status(409).json({
      message: 'Payment opens after the hotel confirms your reservation.',
    });
  }

  const frontendOrigin = CLIENT_ORIGINS[0] ?? 'http://localhost:3000';
  const successRedirectUrl = `${frontendOrigin}/booking/confirm/${bookingIdResult.value}?email=${encodeURIComponent(bookingEmail)}&token=${encodeURIComponent(rawToken || '')}&paid=1`;
  const failureRedirectUrl = `${frontendOrigin}/booking/confirm/${bookingIdResult.value}?email=${encodeURIComponent(bookingEmail)}&token=${encodeURIComponent(rawToken || '')}&paid=0`;

  const checkoutTotal = Number(booking.totalPrice ?? booking.total_amount ?? 0);
  const mode = resolveOnlinePaymentModeFromBooking(booking);
  const due = computeOnlinePaymentDue(checkoutTotal, mode);
  const alreadyCollected = Number(booking.amount_paid ?? booking.amountPaid ?? 0);
  const checkoutAmount = alreadyCollected > 0
    ? Math.min(alreadyCollected, checkoutTotal) || due.amountDue
    : due.amountDue;
  const checkoutLabel = mode === 'full'
    ? `Madyaw full stay payment ${booking.booking_reference ?? bookingIdResult.value}`
    : `Madyaw 50% deposit ${booking.booking_reference ?? bookingIdResult.value}`;

  try {
    const checkout = await createPaymentCheckout({
      bookingId: bookingIdResult.value,
      bookingReference: String(booking.booking_reference ?? ''),
      amount: checkoutAmount,
      guestEmail: bookingEmail,
      guestName: String(booking.guestName ?? 'Guest'),
      description: checkoutLabel,
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

  let booking = await BookingModel.findById(bookingIdResult.value).lean();
  if (!booking) return res.status(404).json({ message: 'Booking not found.' });

  // If hotel staff verified the screenshot in MADYAWPH, finish deposit accounting.
  if (
    booking.payment_proof_verified
    && (booking.payment_proof_stored || booking.payment_proof_filename)
    && Number(booking.amount_paid ?? booking.amountPaid ?? 0) <= 0
  ) {
    try {
      await finalizeDepositAfterHotelVerification(bookingIdResult.value);
      booking = await BookingModel.findById(bookingIdResult.value).lean() ?? booking;
    } catch (error) {
      console.error('[Bookings] Failed to finalize verified deposit on receipt:', error);
    }
  }

  // Privileged staff: only their hotel (super_admin: any).
  if (req.auth && isPrivilegedRole(req.auth.role)) {
    const requester = await getRequestUser(req);
    if (!requester) {
      return res.status(401).json({ message: USER_MESSAGES.accountNotFound });
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
      message: USER_MESSAGES.confirmationLinkInvalid,
    });
  }

  try {
    const payload = verifyReceiptToken(rawToken);
    const bookingEmail = (booking.guestEmail as string | undefined)?.toLowerCase() ?? '';
    if (payload.bookingId !== bookingIdResult.value || payload.email !== bookingEmail) {
      return res.status(403).json({ message: USER_MESSAGES.confirmationLinkMismatch });
    }
    return res.json(serializeBooking(booking as never));
  } catch {
    return res.status(401).json({ message: USER_MESSAGES.confirmationLinkInvalid });
  }
});

export default bookingRoutes;
