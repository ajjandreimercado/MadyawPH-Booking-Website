import { Router, type Request } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { BookingModel, ExternalReservationModel, HotelModel, PropertyModel, RoomCategoryModel, UserModel, BookingValidIdModel, BookingPaymentProofModel } from '../data/mongoModels';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { availabilityLimiter, bookingCreateLimiter, hotelWebhookLimiter, publicReadLimiter } from '../middleware/rateLimiters';
import { isPrivilegedRole } from '../middleware/rbac';
import { priceRoomStay, resolveStayWindow, type HotelStayCharge } from '../utils/hotelStayPricing';
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
  resolveOnlinePaymentModeFromBooking,
} from '../utils/halfPayment';
import { withRetries } from '../utils/withRetries';
import { DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT, findBookedRoomIds, hotelTime, pickRoomForCategory, stayDateOf } from '../utils/roomAvailability';
import { syncPaymentProofToHotelApp, finalizeDepositAfterHotelVerification } from '../utils/syncPaymentProofToHotel';
import { runBookingUploads, type UploadedBookingFile } from '../middleware/validIdUpload';
import { CLIENT_ORIGINS, getHotelWebhookSecret } from '../config/env';
import {
  bookingFileHmacSignature,
  bookingFileUrl,
  bookingFileLinkExpired,
  newBookingFileToken,
  timingSafeEqualString,
  type BookingFileKind,
} from '../utils/bookingFileAccess';
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
  // No client amount (e.g. /quote) → the full server-side 20%; a client amount can only lower it.
  if (clientDiscountAmount === undefined) return serverDiscount;
  const requested = Number(clientDiscountAmount);

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
  times: { checkInTime?: string; checkOutTime?: string } = {},
) {
  // Hotel time window, like the hotel app: check-in 14:00 (or arrival) → check-out 11:00.
  const inDay = stayDateOf(checkInDate);
  const outDay = stayDateOf(checkOutDate);
  if (!inDay || !outDay) {
    throw new Error('Invalid check-in or check-out date.');
  }
  const requestedStart = hotelTime(inDay, times.checkInTime || DEFAULT_CHECK_IN);
  const requestedEnd = hotelTime(outDay, times.checkOutTime || DEFAULT_CHECK_OUT);
  // Checks website and hotel-app bookings (room_id), incl. checked-in guests.
  const booked = await findBookedRoomIds([propertyId], requestedStart, requestedEnd, { excludeBookingId, session });
  return booked.size > 0;
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

class QuoteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface StayQuoteInput {
  /** The room being booked (raw rooms doc) — priced with the hotel app's own formula. */
  room: Record<string, unknown>;
  checkInDate: string;
  checkOutDate: string;
  /** HH:mm — check-in time for the stay window (hourly stays start here). */
  arrivalTime?: string;
  adults: number;
  children: number;
  infants: number;
  discountReason?: string;
  discountAmount?: number;
  promoCode?: string;
  membershipId?: string;
}

type StayQuote = Awaited<ReturnType<typeof priceStay>>;

/**
 * The one place a stay is priced: room total, then the largest single discount among
 * PWD/senior, promo code and Madyaw member. Used by POST / (create) and POST /quote,
 * so the price a guest sees at checkout is the price the booking is saved with.
 */
async function priceStay(input: StayQuoteInput) {
  let charge: HotelStayCharge;
  try {
    charge = await priceRoomStay(input.room, input.checkInDate, input.checkOutDate, input.arrivalTime);
  } catch (error) {
    throw new QuoteError(400, error instanceof Error ? error.message : 'Invalid booking dates.');
  }
  if (!(charge.amount > 0)) {
    throw new QuoteError(409, 'This room type has no price set yet. Please choose another room or contact the hotel.');
  }
  const pricing = {
    nights: charge.nights,
    guestCount: Math.max(1, input.adults + input.children + input.infants),
    // One night (nightly) or one block (hourly), after surge — as the hotel app charges it.
    roomRate: charge.unitPrice,
    totalPrice: charge.amount,
    charge,
  };

  const canonicalDiscountReason = normalizeDiscountReason(input.discountReason);
  const eligibilityDiscount = resolveServerDiscount(
    canonicalDiscountReason,
    pricing.totalPrice,
    input.discountAmount,
  );

  let promoDiscount = 0;
  let promoCode = '';
  try {
    const promo = await resolvePromoDiscount(input.promoCode, pricing.totalPrice);
    promoDiscount = promo.discountAmount;
    promoCode = promo.code;
  } catch (error) {
    throw new QuoteError(400, error instanceof Error ? error.message : 'Invalid promo code.');
  }

  let memberDiscount = 0;
  let membershipId = '';
  let memberDiscountPercent = 0;
  const rawMembershipId = input.membershipId?.trim() ?? '';
  if (rawMembershipId) {
    const member = await resolveMemberDiscount(rawMembershipId, pricing.totalPrice);
    if (!member.valid) {
      throw new QuoteError(400, member.message || 'Invalid membership ID.');
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

  return {
    pricing,
    resolvedDiscount,
    promoCode,
    membershipId,
    finalDiscountReason,
    finalDiscountType,
    finalDiscountValue,
    finalTotalPrice,
  };
}

type ResolvedRoom =
  | { ok: true; roomId: string; byCategory: boolean }
  | { ok: false; status: number; message: string };

/**
 * Guests book a room type (categoryId) and the server assigns a free room of that type for
 * the stay (the hotel can reassign it in the hotel app). Older callers may still send a
 * specific room (propertyId).
 */
async function resolveBookingRoom(body: {
  categoryId?: unknown;
  propertyId?: unknown;
  checkInDate?: unknown;
  checkOutDate?: unknown;
  arrivalTime?: unknown;
}): Promise<ResolvedRoom> {
  if (body.categoryId !== undefined && body.categoryId !== '') {
    const categoryResult = validateId(body.categoryId, 'Room type');
    if (!categoryResult.ok) return { ok: false, status: 400, message: categoryResult.message };
    const inDay = stayDateOf(body.checkInDate);
    const outDay = stayDateOf(body.checkOutDate);
    if (!inDay || !outDay || outDay < inDay) return { ok: false, status: 400, message: USER_MESSAGES.invalidDates };
    const category = (await RoomCategoryModel.findById(categoryResult.value).lean()) as Record<string, unknown> | null;
    if (!category) return { ok: false, status: 404, message: 'Room type not found.' };
    // Same hold window the hotel app uses (hourly categories: blocks from the arrival time).
    const stay = resolveStayWindow(category, category, inDay, outDay, String(body.arrivalTime ?? ''));
    const room = await pickRoomForCategory(categoryResult.value, stay.start, stay.end);
    if (!room) {
      return {
        ok: false,
        status: 409,
        message: 'No rooms of this type are free for your dates. Please choose other dates or another room type.',
      };
    }
    return { ok: true, roomId: String(room._id), byCategory: true };
  }
  const roomResult = validateId(body.propertyId, 'Room');
  if (!roomResult.ok) return { ok: false, status: 400, message: roomResult.message };
  return { ok: true, roomId: roomResult.value, byCategory: false };
}

// ─── POST /quote ──────────────────────────────────────────────────────────────
// Read-only price + availability for checkout. Creates nothing; same pricing as POST /.

bookingRoutes.post('/quote', availabilityLimiter, async (req, res) => {
  const body = pickFields(req.body ?? {}, [
    'categoryId', 'propertyId', 'checkInDate', 'checkOutDate', 'adults', 'children', 'infants',
    'roomType', 'discountReason', 'promoCode', 'membershipId', 'arrivalTime',
  ] as const);
  const quoteArrival = typeof body.arrivalTime === 'string' && ARRIVAL_TIME_RE.test(body.arrivalTime) ? body.arrivalTime : undefined;
  const checkInResult = validateString(body.checkInDate, 'Check-in date', 1, 30);
  if (!checkInResult.ok) return res.status(400).json({ message: checkInResult.message });
  const checkOutResult = validateString(body.checkOutDate, 'Check-out date', 1, 30);
  if (!checkOutResult.ok) return res.status(400).json({ message: checkOutResult.message });
  const checkIn = new Date(checkInResult.value);
  const checkOut = new Date(checkOutResult.value);
  // Same-day is allowed: an hourly room booked for one block on the check-in day.
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime()) || checkOut < checkIn) {
    return res.status(400).json({ message: USER_MESSAGES.invalidDates });
  }
  const adultsResult = validateInteger(Number(body.adults ?? 1), 'Adults', 1, 20);
  if (!adultsResult.ok) return res.status(400).json({ message: adultsResult.message });
  const childrenResult = validateOptionalInteger(
    body.children === undefined || body.children === '' ? undefined : Number(body.children), 'Children', 0, 20, 0,
  );
  if (!childrenResult.ok) return res.status(400).json({ message: childrenResult.message });
  const infantsResult = validateOptionalInteger(
    body.infants === undefined || body.infants === '' ? undefined : Number(body.infants), 'Infants', 0, 10, 0,
  );
  if (!infantsResult.ok) return res.status(400).json({ message: infantsResult.message });
  const roomTypeResult = validateString(body.roomType ?? 'standard-room', 'Room type', 1, 100);
  if (!roomTypeResult.ok) return res.status(400).json({ message: roomTypeResult.message });
  const discountReasonResult = validateOptionalString(body.discountReason, 'Discount reason', 80);
  if (!discountReasonResult.ok) return res.status(400).json({ message: discountReasonResult.message });
  const promoCodeResult = validateOptionalString(body.promoCode, 'Promo code', 50);
  if (!promoCodeResult.ok) return res.status(400).json({ message: promoCodeResult.message });
  const membershipIdResult = validateOptionalString(body.membershipId, 'Membership ID', 40);
  if (!membershipIdResult.ok) return res.status(400).json({ message: membershipIdResult.message });

  const resolved = await resolveBookingRoom(body);
  if (resolved.ok === false) return res.status(resolved.status).json({ message: resolved.message });

  const property = await PropertyModel.findById(resolved.roomId).lean();
  if (!property) return res.status(404).json({ message: 'Room not found.' });

  try {
    const quote = await priceStay({
      room: property as Record<string, unknown>,
      checkInDate: checkInResult.value,
      checkOutDate: checkOutResult.value,
      arrivalTime: quoteArrival,
      adults: adultsResult.value,
      children: childrenResult.value,
      infants: infantsResult.value,
      discountReason: discountReasonResult.value ?? undefined,
      promoCode: promoCodeResult.value ?? undefined,
      membershipId: membershipIdResult.value ?? undefined,
    });
    const win = quote.pricing.charge.window;
    const available = !(await hasBookingOverlap(resolved.roomId, win.checkInDate, win.checkOutDate, undefined, null, {
      checkInTime: win.checkInTime,
      checkOutTime: win.checkOutTime,
    }));
    return res.json({
      available,
      // Hotel app billing for the stay (hourly rooms are charged per block).
      billingMode: quote.pricing.charge.billingMode,
      stayHours: quote.pricing.charge.stayHours,
      blockHours: quote.pricing.charge.blockHours,
      blocks: quote.pricing.charge.blocks,
      checkInTime: win.checkInTime,
      checkOutTime: win.checkOutTime,
      checkOutDate: win.checkOutDate,
      // Shown to the guest: the room type, never the room number.
      roomName: property.category_name ?? '',
      hotelName: await hotelNameOf(property),
      hotelLocation: property.hotel_location ?? '',
      freeCancellation: property.free_cancellation === true,
      nights: quote.pricing.nights,
      roomRate: quote.pricing.roomRate,
      stayPrice: quote.pricing.totalPrice,
      discountAmount: quote.resolvedDiscount,
      discountType: quote.finalDiscountType,
      discountReason: quote.finalDiscountReason,
      totalPrice: quote.finalTotalPrice,
      // Guests pay the full stay by the hotel's QR when they book; the hotel verifies it.
      dueNow: computeOnlinePaymentDue(quote.finalTotalPrice, 'full').amountDue,
      dueAfterConfirmation: 0,
      taxesIncluded: true,
    });
  } catch (error) {
    const status = error instanceof QuoteError ? error.status : 400;
    const message = error instanceof Error ? error.message : 'Unable to price this stay.';
    return res.status(status).json({ message });
  }
});

const ARRIVAL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type PaymentProofCheck =
  | { ok: true; ref: string; amountClaimed: number; sha256: string }
  | { ok: false; status: number; message: string };

/** Validate a payment screenshot + wallet reference before anything is saved. */
async function checkPaymentProof(
  file: UploadedBookingFile | undefined,
  rawRef: unknown,
  rawAmount: unknown,
  amountDue: number,
): Promise<PaymentProofCheck> {
  if (!file) {
    return { ok: false, status: 400, message: 'Please upload the screenshot of your GCash/Maya payment.' };
  }
  const refRaw = validateString(rawRef, 'Payment transaction reference', 6, 64);
  if (!refRaw.ok) {
    return { ok: false, status: 400, message: 'Enter the reference number from your GCash/Maya receipt (at least 6 characters).' };
  }
  const ref = refRaw.value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9\-_/]{5,63}$/i.test(ref)) {
    return { ok: false, status: 400, message: 'The reference number looks invalid. Copy it exactly from your receipt.' };
  }
  if (!(amountDue > 0)) {
    return {
      ok: false,
      status: 409,
      message: 'This stay could not be priced. Please go back and choose the room again.',
    };
  }
  // Guest types the amount from their receipt — hotel staff verify it in MADYAWPH.
  if (rawAmount === undefined || rawAmount === '' || rawAmount === null) {
    return {
      ok: false,
      status: 400,
      message: 'Enter the amount you paid (from your GCash/Maya receipt).',
    };
  }
  const claimed = Number(rawAmount);
  if (!Number.isFinite(claimed) || claimed <= 0) {
    return {
      ok: false,
      status: 400,
      message: 'Enter a valid amount paid greater than ₱0.',
    };
  }
  // Website stays are paid in full: the receipt must show the stay total (±₱1 for rounding).
  if (Math.abs(claimed - amountDue) > 1) {
    return {
      ok: false,
      status: 400,
      message: `Your receipt amount must match the stay total of ₱${amountDue.toLocaleString()}. Pay the full amount by the hotel's QR, then enter it here.`,
    };
  }
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  if (await BookingModel.findOne({ payment_proof_sha256: sha256 }).select('_id').lean()) {
    return { ok: false, status: 409, message: 'This payment screenshot was already used on another booking. Upload the receipt for this stay.' };
  }
  if (await BookingModel.findOne({ payment_transaction_ref: ref }).select('_id').lean()) {
    return { ok: false, status: 409, message: 'This reference number was already used on another booking.' };
  }
  return { ok: true, ref, amountClaimed: Math.round(claimed * 100) / 100, sha256 };
}

/** Save the screenshot on the booking (unverified) and push it everywhere the hotel app reads. */
async function savePaymentProof(
  booking: {
    _id: unknown;
    booking_reference?: unknown;
    hotel_id?: unknown;
    room_id?: unknown;
    nights?: unknown;
    roomRate?: unknown;
    paymentMethod?: unknown;
    payment_method?: unknown;
  },
  file: UploadedBookingFile,
  proof: { ref: string; amountClaimed: number; sha256: string },
  stayTotal: number,
  amountDue: number,
): Promise<{ proofUrl: string; accessToken: string }> {
  const bookingId = String(booking._id);
  const now = new Date();
  const base64 = file.buffer.toString('base64');
  const filename = file.originalname.slice(0, 200);
  const accessToken = newBookingFileToken();
  const proofUrl = bookingFileUrl(bookingId, 'payment-proof', accessToken);
  // Do NOT mark amount_paid / payment_status as paid — hotel staff verify the screenshot first.
  await BookingModel.updateOne(
    { _id: booking._id },
    {
      $set: {
        payment_proof_filename: filename,
        payment_proof_mime: file.mimetype,
        payment_proof_size: file.size,
        payment_proof_base64: base64,
        payment_proof_stored: true,
        payment_proof_uploaded_at: now,
        payment_transaction_ref: proof.ref,
        payment_proof_amount_claimed: proof.amountClaimed,
        payment_proof_sha256: proof.sha256,
        payment_proof_verified: false,
        payment_proof_verified_at: null,
        payment_proof_url: proofUrl,
        // MADYAWPH shows the receipt from payment_screenshot_url.
        payment_screenshot_url: proofUrl,
        payment_proof_access_token: accessToken,
        deposit_amount: amountDue,
        amountPaid: 0,
        amount_paid: 0,
        balance_due: stayTotal,
        payment_status: 'unpaid',
      },
    },
  );
  await syncPaymentProofToHotelApp({
    bookingId,
    bookingReference: String(booking.booking_reference ?? ''),
    hotelId: String(booking.hotel_id ?? ''),
    roomId: String(booking.room_id ?? ''),
    filename,
    mime: file.mimetype,
    size: file.size,
    base64,
    transactionRef: proof.ref,
    amountClaimed: proof.amountClaimed,
    expectedDeposit: amountDue,
    stayTotal,
    nights: Number(booking.nights ?? 1),
    roomRate: Number(booking.roomRate ?? 0),
    paymentMethod: String(booking.paymentMethod ?? booking.payment_method ?? ''),
    uploadedAt: now,
    proofUrl,
    accessToken,
  });
  return { proofUrl, accessToken };
}

/** Room docs often lack hotel_name; fall back to the hotel record. */
async function hotelNameOf(property: object): Promise<string> {
  const room = property as { hotel_name?: unknown; hotelName?: unknown; hotel_id?: unknown };
  const name = String(room.hotel_name ?? room.hotelName ?? '').trim();
  if (name || !room.hotel_id) return name;
  try {
    const hotelDoc = await HotelModel.findById(String(room.hotel_id)).select('name').lean();
    return String((hotelDoc as { name?: unknown } | null)?.name ?? '').trim();
  } catch {
    return ''; // Email code still tries HotelModel later.
  }
}

// ─── GET /:bookingId/files/:kind ─────────────────────────────────────────────
// Valid ID / payment screenshot for hotel staff via guest_id_url / payment_proof_url.
// Auth: ?token= (preferred) or legacy ?sig= HMAC.

bookingRoutes.get('/:bookingId/files/:kind', publicReadLimiter, async (req, res) => {
  const idResult = validateId(req.params.bookingId, 'Booking ID');
  const kind = req.params.kind as BookingFileKind;
  if (!idResult.ok || (kind !== 'valid-id' && kind !== 'payment-proof')) {
    return res.status(404).json({ message: 'File not found.' });
  }

  const bookingId = idResult.value;
  const rawToken = req.query.token;
  const token = (Array.isArray(rawToken) ? String(rawToken[0] ?? '') : typeof rawToken === 'string' ? rawToken : '').trim();
  const rawSig = req.query.sig;
  const sig = (Array.isArray(rawSig) ? String(rawSig[0] ?? '') : typeof rawSig === 'string' ? rawSig : '').trim();

  const urlHasToken = (raw: unknown, expected: string): boolean => {
    const value = String(raw ?? '');
    if (!expected || !value.includes('token=')) return false;
    try {
      const parsed = new URL(value);
      const embedded = parsed.searchParams.get('token') || '';
      return Boolean(embedded) && timingSafeEqualString(expected, embedded);
    } catch {
      return value.includes(`token=${expected}`);
    }
  };

  // Prefer native reads — Mongoose findById can miss string/ObjectId _id shapes in shared hotel_hms.
  const db = mongoose.connection.db;
  let lookupError = '';
  let rawBooking: Record<string, unknown> | null = null;
  let rawValidId: Record<string, unknown> | null = null;
  let rawProof: Record<string, unknown> | null = null;
  if (db) {
    try {
      const oid = mongoose.isValidObjectId(bookingId) ? new mongoose.Types.ObjectId(bookingId) : null;
      rawBooking = (oid
        ? await db.collection('bookings').findOne({ _id: oid })
        : await db.collection('bookings').findOne({ _id: bookingId as never })) as Record<string, unknown> | null;
      // booking_id is stored as a string on side collections.
      rawValidId = await db.collection('booking_valid_ids').findOne({ booking_id: bookingId }) as Record<string, unknown> | null;
      rawProof = await db.collection('booking_payment_proofs').findOne({ booking_id: bookingId }) as Record<string, unknown> | null;
      // Some older rows stored booking_id as the ObjectId string of a different shape — try oid hex too.
      if (!rawValidId && oid) {
        rawValidId = await db.collection('booking_valid_ids').findOne({
          $or: [{ booking_id: bookingId }, { booking_id: String(oid) }],
        }) as Record<string, unknown> | null;
      }
      if (!rawProof && oid) {
        rawProof = await db.collection('booking_payment_proofs').findOne({
          $or: [{ booking_id: bookingId }, { booking_id: String(oid) }],
        }) as Record<string, unknown> | null;
      }
    } catch (error) {
      lookupError = error instanceof Error ? error.message.slice(0, 120) : 'lookup failed';
    }
  }

  let authorized = false;
  if (token) {
    if (kind === 'valid-id') {
      authorized = Boolean(
        (rawBooking?.guest_id_access_token && timingSafeEqualString(token, String(rawBooking.guest_id_access_token)))
        || (rawValidId?.access_token && timingSafeEqualString(token, String(rawValidId.access_token)))
        || urlHasToken(rawBooking?.guest_id_url, token),
      );
    } else {
      authorized = Boolean(
        (rawBooking?.payment_proof_access_token && timingSafeEqualString(token, String(rawBooking.payment_proof_access_token)))
        || (rawProof?.access_token && timingSafeEqualString(token, String(rawProof.access_token)))
        || (rawValidId?.payment_proof_access_token
          && timingSafeEqualString(token, String(rawValidId.payment_proof_access_token)))
        || urlHasToken(rawBooking?.payment_proof_url, token),
      );
    }
  } else if (sig) {
    authorized = timingSafeEqualString(sig, bookingFileHmacSignature(bookingId, kind));
  }

  if (!authorized) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (lookupError) {
      console.warn(`[Bookings] File lookup error for ${bookingId}: ${lookupError}`);
    }
    return res.status(403).json({ message: 'This link is not valid.' });
  }

  if (bookingFileLinkExpired(rawBooking?.checkOutDate ?? rawBooking?.check_out_date)) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(410).json({ message: 'This link has expired.' });
  }

  let base64 = '';
  let mime = 'application/octet-stream';
  if (kind === 'valid-id') {
    base64 = String(rawValidId?.base64 ?? '');
    mime = String(rawValidId?.mime || mime);
  } else {
    base64 = String(
      rawProof?.base64
      ?? rawValidId?.payment_proof_base64
      ?? rawBooking?.payment_proof_base64
      ?? '',
    );
    mime = String(
      rawProof?.mime
      || rawValidId?.payment_proof_mime
      || rawBooking?.payment_proof_mime
      || mime,
    );
  }

  if (!base64) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(404).json({ message: 'File not found.' });
  }
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'inline');
  // Allow hotel app (different origin) to embed the image.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.send(Buffer.from(base64, 'base64'));
});

// ─── POST /hotel-events ───────────────────────────────────────────────────────
// Hotel management app callback when an Online Booking is approved/rejected.
// Auth: Authorization: Bearer <HOTEL_WEBHOOK_SECRET>  (or X-Madyaw-Hotel-Secret)

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

// requireAuth: bookings are owned by the signed-in account (guestEmail locked to session).
bookingRoutes.post('/', requireAuth, bookingCreateLimiter, async (req, res) => {
  const requester = await getRequestUser(req);
  if (!requester) {
    return res.status(401).json({ message: USER_MESSAGES.accountNotFound });
  }

  let validIdFile: UploadedBookingFile | undefined;
  let paymentProofFile: UploadedBookingFile | undefined;
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType.includes('multipart/form-data')) {
    try {
      const uploads = await runBookingUploads(req, res);
      validIdFile = uploads.validId;
      paymentProofFile = uploads.paymentProof;
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

  // Guests pay by the hotel's QR when they book and attach the screenshot (checked below).

  // OWASP A03: strip unexpected fields — only pick known booking fields
  // multipart fields arrive as strings; coerce occupancy numbers below.
  const body = pickFields(req.body, [
    'categoryId',
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
    'arrivalTime',
  ] as const);

  const arrivalTime = typeof body.arrivalTime === 'string' && ARRIVAL_TIME_RE.test(body.arrivalTime)
    ? body.arrivalTime
    : '';

  // ── Required field validation ─────────────────────────────────────────────

  const resolvedRoom = await resolveBookingRoom(body);
  if (resolvedRoom.ok === false) {
    return res.status(resolvedRoom.status).json({ message: resolvedRoom.message });
  }
  const propertyIdResult = { ok: true as const, value: resolvedRoom.roomId };

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

  if (new Date(checkOutResult.value) < new Date(checkInResult.value)) {
    return res.status(400).json({ message: 'Check-out must be after check-in.' });
  }

  // Accept any string for room type (property room labels vary); normalize payment methods.
  // Room-type bookings take the assigned room's type after it loads (see below).
  const roomTypeCheck = resolvedRoom.byCategory ? null : validateString(body.roomType, 'Room type', 1, 100);
  if (roomTypeCheck && !roomTypeCheck.ok) return res.status(400).json({ message: roomTypeCheck.message });
  const roomTypeResult = { value: roomTypeCheck?.ok ? roomTypeCheck.value : '' };

  const rawPaymentMethod = validateString(body.paymentMethod, 'Payment method', 1, 100);
  if (!rawPaymentMethod.ok) return res.status(400).json({ message: rawPaymentMethod.message });
  const paymentMethodResult = validateEnum(
    normalizePaymentMethod(rawPaymentMethod.value),
    'Payment method',
    PAYMENT_METHOD_VALUES,
  );
  if (!paymentMethodResult.ok) return res.status(400).json({ message: paymentMethodResult.message });

  // ── Guest field validation ────────────────────────────────────────────────

  const rawGuestName = body.guestName || requester.name;
  const guestNameResult = validateString(rawGuestName, 'Guest name', 1, 80);
  if (!guestNameResult.ok) return res.status(400).json({ message: guestNameResult.message });

  // Ownership: always use the signed-in account email (ignore client spoofing).
  const guestEmailResult = validateEmail(requester.email);
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
  if (resolvedRoom.byCategory) {
    roomTypeResult.value = property.room_type || 'standard-room';
  }

  if (String(property.billing_mode ?? '').toLowerCase() !== 'hourly'
    && stayDateOf(checkOutResult.value) === stayDateOf(checkInResult.value)) {
    return res.status(400).json({ message: 'Check-out must be after check-in.' });
  }

  // Website reservations always require full stay payment after hotel confirmation.
  const paymentMode = 'full' as const;

  let quote: StayQuote;
  try {
    quote = await priceStay({
      room: property as Record<string, unknown>,
      checkInDate: checkInResult.value,
      checkOutDate: checkOutResult.value,
      arrivalTime: arrivalTime || undefined,
      adults: adultsResult.value,
      children: childrenResult.value,
      infants: infantsResult.value,
      discountReason: discountReasonResult.value ?? undefined,
      discountAmount: rawDiscountAmount === undefined ? undefined : discountAmountResult.value,
      promoCode: promoCodeResult.value ?? undefined,
      membershipId: membershipIdResult.value ?? undefined,
    });
  } catch (error) {
    const status = error instanceof QuoteError ? error.status : 400;
    const message = error instanceof Error ? error.message : 'Invalid booking details.';
    return res.status(status).json({ message });
  }

  const stayWindow = quote.pricing.charge.window;
  const stayTimes = { checkInTime: stayWindow.checkInTime, checkOutTime: stayWindow.checkOutTime };
  try {
    if (await hasBookingOverlap(propertyIdResult.value, stayWindow.checkInDate, stayWindow.checkOutDate, undefined, null, stayTimes)) {
      return res.status(409).json({ message: 'The requested dates are not available.' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify availability.';
    return res.status(400).json({ message });
  }

  const createdAt = new Date();
  const {
    pricing,
    resolvedDiscount,
    promoCode,
    membershipId,
    finalDiscountReason,
    finalDiscountType,
    finalDiscountValue,
    finalTotalPrice,
  } = quote;

  // Shared MongoDB with the hotel management app:
  // - This website only INSERTS a reservation request (never deletes hotel/ops data).
  // - Do NOT write check_in_date/check_out_date here — that makes the hotel app treat
  //   the request as a room hold and blocks Online Booking approval (self-overlap).
  // - Stay Dates for the hotel queue live on external_reservations only until approval.
  // Guests pay by QR when they book — reserve the room immediately for hotel check-in.
  const hotelAppFields = buildHotelAppBookingFields({
    guestName: guestNameResult.value,
    guestEmail: guestEmailResult.value,
    checkInDate: checkInResult.value,
    checkOutDate: checkOutResult.value,
    paymentMethod: paymentMethodResult.value,
    now: createdAt,
    includeStayDates: true,
  });

  const stayDatesForQueue = {
    checkInDate: toStayDate(stayWindow.checkInDate),
    checkOutDate: toStayDate(stayWindow.checkOutDate),
  };

  const { amountDue, balanceDue, depositPercent, mode: onlinePaymentMode } =
    computeOnlinePaymentDue(finalTotalPrice, paymentMode);
  // Deposit / full stay amount is collected after hotel confirmation — create as unpaid.
  const paymentStatus = 'unpaid' as const;
  if (onlinePaymentMode === 'full' && finalTotalPrice > 0 && amountDue !== finalTotalPrice) {
    console.error('[Bookings] Full payment must equal stay total', { finalTotalPrice, amountDue });
  }

  const proofCheck = await checkPaymentProof(
    paymentProofFile,
    body.paymentTransactionRef,
    body.paymentProofAmountClaimed,
    amountDue,
  );
  if (proofCheck.ok === false) {
    return res.status(proofCheck.status).json({ message: proofCheck.message });
  }

  const hotelIdForBooking = String(property.hotel_id ?? '');
  const hotelNameForEmail = await hotelNameOf(property);

  const bookingDoc = {
    booking_reference: `BR-${Date.now()}`,
    hotel_id: hotelIdForBooking,
    // Used so guest emails say "Welcome to {hotel}" even if HotelModel lookup fails.
    ...(hotelNameForEmail ? { hotel_name: hotelNameForEmail } : {}),
    room_id: toHotelRoomId(property._id),
    propertyId: propertyIdResult.value,
    // Room-type bookings are named after the type; the guest never sees the room number.
    propertyName: resolvedRoom.byCategory
      ? (property.category_name || property.display_name)
      : (propertyNameResult.value ?? property.display_name),
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
    checkInDate: stayWindow.checkInDate,
    checkOutDate: stayWindow.checkOutDate,
    adults: adultsResult.value,
    children: childrenResult.value,
    infants: infantsResult.value,
    roomType: roomTypeResult.value,
    // Hotel app stay window + billing (CustomerStayPricing::bookingFieldsFromCharge).
    check_in_time: stayWindow.checkInTime,
    check_out_time: stayWindow.checkOutTime,
    billing_mode: pricing.charge.billingMode,
    ...(pricing.charge.billingMode === 'hourly'
      ? {
        stay_hours: pricing.charge.stayHours,
        booked_stay_hours: pricing.charge.stayHours,
        block_hours: pricing.charge.blockHours,
        price_per_block: pricing.charge.unitPrice,
      }
      : {}),
    paymentMethod: paymentMethodResult.value,
    source: 'web',
    nights: pricing.nights,
    guestCount: pricing.guestCount,
    roomRate: pricing.roomRate,
    serviceFee: 0,
    totalPrice: finalTotalPrice,
    total_amount: finalTotalPrice,
    // Paid by QR at checkout; hotel still verifies the screenshot in MADYAWPH.
    amountPaid: 0,
    amount_paid: 0,
    deposit_amount: amountDue,
    balance_due: finalTotalPrice,
    online_payment_mode: onlinePaymentMode,
    deposit_percent: depositPercent,
    payment_status: paymentStatus,
    // Hotel Online Bookings queue expects "pending" here; hotel approval sets reserved.
    // Do NOT write check_in_date/check_out_date on create (inventory hold).
    status: 'pending',
    requestedAt: createdAt.toISOString(),
    confirmationSendStatus: 'none' as const,
    confirmationSentAt: null as null,
    confirmationSendError: '',
  };

  const propertyIdValue = propertyIdResult.value;
  const checkInValue = stayWindow.checkInDate;
  const checkOutValue = stayWindow.checkOutDate;

  async function persistBooking(session: mongoose.ClientSession | null) {
    if (session) {
      if (await hasBookingOverlap(propertyIdValue, checkInValue, checkOutValue, undefined, session, stayTimes)) {
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

    if (await hasBookingOverlap(propertyIdValue, checkInValue, checkOutValue, undefined, null, stayTimes)) {
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

  // Stable token URLs (same fields hotel walk-ins use: guest_id_url / payment_proof_url).
  const validIdToken = newBookingFileToken();
  const guestIdUrl = bookingFileUrl(bookingId, 'valid-id', validIdToken);
  let paymentProofUrl = '';

  // Store Valid ID binary off the booking document so hotel list/login queries stay lean.
  try {
    await withRetries(async () => {
      await BookingValidIdModel.findOneAndUpdate(
        { booking_id: bookingId },
        {
          $set: {
            booking_id: bookingId,
            booking_reference: String(booking.booking_reference),
            hotel_id: String(booking.hotel_id ?? property.hotel_id ?? ''),
            filename: validIdFile.originalname.slice(0, 200),
            mime: validIdFile.mimetype,
            size: validIdFile.size,
            base64: validIdFile.buffer.toString('base64'),
            uploaded_at: createdAt,
            access_token: validIdToken,
          },
        },
        { upsert: true, new: true },
      );
    }, { attempts: 3, delayMs: 200, label: 'booking_valid_ids store' });
  } catch (idStoreError) {
    console.error('[Bookings] Failed to store Valid ID in booking_valid_ids:', idStoreError);
  }

  // Payment screenshot first — hotel Online Bookings row must include it at create time.
  try {
    if (paymentProofFile && proofCheck.ok) {
      const saved = await savePaymentProof(booking, paymentProofFile, proofCheck, finalTotalPrice, amountDue);
      paymentProofUrl = saved.proofUrl;
      if (typeof (booking as { set?: (v: Record<string, unknown>) => void }).set === 'function') {
        (booking as { set: (v: Record<string, unknown>) => void }).set({
          payment_proof_stored: true,
          payment_proof_amount_claimed: proofCheck.amountClaimed,
          payment_proof_url: paymentProofUrl,
          // MADYAWPH shows the receipt from payment_screenshot_url.
          payment_screenshot_url: paymentProofUrl,
        });
      }
    }
  } catch (proofError) {
    const msg = proofError instanceof Error ? proofError.message : String(proofError);
    syncErrors.push(`payment-proof:${msg}`);
    console.error('[Bookings] Failed to store/sync payment screenshot:', proofError);
  }

  // Online Bookings queue = external_reservations with pending_approval (not reserved).
  // Keep payment screenshot + ID links on the row so staff can open them from MADYAWPH.
  // Do NOT write billing_charges yet — a room charge is an inventory hold and blocks approval.
  try {
    await withRetries(async () => {
      const existing = await ExternalReservationModel.countDocuments({
        booking_id: bookingId,
        external_reference: String(booking.booking_reference),
      });
      if (existing > 0) return;

      const proofOk = Boolean(paymentProofFile && proofCheck.ok && paymentProofUrl);
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
        // Guest-claimed receipt amount — hotel Payments UI reads amount_paid / payment_proof_amount_claimed.
        amountPaid: proofOk ? proofCheck.amountClaimed : 0,
        balanceDue: proofOk
          ? Math.max(0, finalTotalPrice - proofCheck.amountClaimed)
          : finalTotalPrice,
        onlinePaymentMode,
        depositPercent,
        paymentStatus: 'unpaid',
        nights: pricing.nights,
        adults: adultsResult.value,
        children: childrenResult.value,
        now: createdAt,
        validIdUploaded: true,
        validIdFilename: validIdFile.originalname.slice(0, 200),
        guestIdUrl,
        checkInTime: stayWindow.checkInTime,
        checkOutTime: stayWindow.checkOutTime,
        billingMode: pricing.charge.billingMode,
        stayHours: pricing.charge.stayHours ?? undefined,
        blockHours: pricing.charge.blockHours ?? undefined,
        pricePerBlock: pricing.charge.billingMode === 'hourly' ? pricing.charge.unitPrice : undefined,
        paymentProofUploaded: proofOk,
        paymentProofFilename: proofOk ? paymentProofFile!.originalname.slice(0, 200) : undefined,
        paymentProofMime: proofOk ? paymentProofFile!.mimetype : undefined,
        paymentTransactionRef: proofOk ? proofCheck.ref : undefined,
        paymentProofAmountClaimed: proofOk ? proofCheck.amountClaimed : undefined,
        paymentProofExpectedAmount: amountDue,
        paymentProofVerified: false,
        paymentProofUrl: proofOk ? paymentProofUrl : undefined,
      });
      await ExternalReservationModel.create({
        ...externalDoc,
        // Top-level aliases matching hotel booking fields.
        guest_id_url: guestIdUrl,
        ...(proofOk
          ? {
            payment_proof_url: paymentProofUrl,
            // MADYAWPH shows the receipt from payment_screenshot_url.
            payment_screenshot_url: paymentProofUrl,
            amount_paid: proofCheck.amountClaimed,
            payment_proof_amount_claimed: proofCheck.amountClaimed,
          }
          : {}),
      });
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

  // Hotel walk-ins store guest_id_url on the booking — mirror that for website stays.
  await BookingModel.updateOne(
    { _id: booking._id },
    {
      $set: {
        guest_id_url: guestIdUrl,
        guest_id_access_token: validIdToken,
        ...(paymentProofUrl ? { payment_proof_url: paymentProofUrl, payment_screenshot_url: paymentProofUrl } : {}),
      },
    },
  ).catch((error) => console.error('[Bookings] Failed to set guest/payment file URLs:', error));

  if (syncErrors.length > 0) {
    await BookingModel.updateOne(
      { _id: booking._id },
      { $set: { hotel_sync_error: syncErrors.join(' | ').slice(0, 500) } },
    );
  }

  // No email at checkout — the guest's only email is the hotel's welcome, sent when the
  // hotel approves the booking (see hotelBookingSync → sendBookingConfirmationNotification).

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
      null,
      {
        checkInTime: String((booking as { check_in_time?: unknown }).check_in_time ?? '') || undefined,
        checkOutTime: String((booking as { check_out_time?: unknown }).check_out_time ?? '') || undefined,
      },
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

bookingRoutes.post('/:bookingId/payment-proof', optionalAuth, bookingCreateLimiter, async (req, res) => {
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

  let allowed = false;
  if (rawToken) {
    try {
      const payload = verifyReceiptToken(rawToken);
      allowed = payload.bookingId === bookingIdResult.value && payload.email === bookingEmail;
    } catch {
      allowed = false;
    }
  }
  if (!allowed && req.auth) {
    const requester = await getRequestUser(req);
    if (requester && requester.email === bookingEmail) {
      allowed = true;
    }
  }
  if (!allowed) {
    return res.status(403).json({
      message: 'Sign in to your account or open the confirmation link from your email to upload payment proof.',
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

  const proofCheck = await checkPaymentProof(
    paymentProofFile,
    req.body?.paymentTransactionRef,
    req.body?.paymentProofAmountClaimed,
    amountDue,
  );
  if (proofCheck.ok === false) {
    return res.status(proofCheck.status).json({ message: proofCheck.message });
  }

  try {
    await savePaymentProof(booking, paymentProofFile, proofCheck, stayTotal, amountDue);
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
