import { Router, type Request } from 'express';
import { BookingModel, PropertyModel, UserModel } from '../data/mongoModels';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { availabilityLimiter } from '../middleware/rateLimiters';
import { calculateBookingPricing } from '../utils/pricing';
import { serializeBooking } from '../utils/serialize';
import { sendBookingConfirmationNotification } from '../services/notificationService';
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
type BookingStatus = 'requested' | 'accepted' | 'declined' | 'paid' | 'confirmed' | 'pending';

const ACTIVE_BOOKING_STATUSES = ['requested', 'accepted', 'paid', 'confirmed', 'pending'] as const;

// Allowlists — validated server-side, never taken verbatim from client input (OWASP A03)
const ROOM_TYPE_VALUES = ['standard-room', 'deluxe-suite', 'family-suite', 'villa-retreat'] as const;
const PAYMENT_METHOD_VALUES = ['credit-card', 'debit-card', 'gcash', 'maya', 'bank-transfer'] as const;
const BOOKING_STATUS_VALUES = ['requested', 'accepted', 'declined', 'paid', 'confirmed', 'pending'] as const;

type RoomType = typeof ROOM_TYPE_VALUES[number];
type PaymentMethod = typeof PAYMENT_METHOD_VALUES[number];

const GUEST_STATUS_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  pending: ['confirmed'],
  requested: ['confirmed', 'accepted'],
  accepted: ['paid'],
  paid: ['confirmed'],
};

function isPrivilegedRole(role: UserRole) {
  return role === 'admin' || role === 'staff' || role === 'super_admin';
}

function resolveServerDiscount(
  discountReason: string | undefined,
  pricingTotal: number,
  clientDiscountAmount?: number,
): number {
  const normalizedReason = discountReason?.trim().toLowerCase();
  const allowedReasons = new Set(['pwd', 'senior citizen']);

  if (!normalizedReason || !allowedReasons.has(normalizedReason)) {
    return 0;
  }

  const serverDiscount = Math.round(pricingTotal * 0.2);
  const requested = Number(clientDiscountAmount ?? 0);

  if (!Number.isFinite(requested) || requested < 0) {
    return serverDiscount;
  }

  return Math.min(serverDiscount, Math.round(requested));
}

async function hasBookingOverlap(
  propertyId: string,
  checkInDate: string,
  checkOutDate: string,
  excludeBookingId?: string,
) {
  console.log(`[MongoDB Query] Collection: bookings, Query: ${JSON.stringify({ propertyId, status: { $in: ACTIVE_BOOKING_STATUSES } })}`);
  const bookings = await BookingModel.find({
    propertyId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
  }).lean();
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

    const existingStart = new Date(booking.checkInDate);
    const existingEnd = new Date(booking.checkOutDate);
    return requestedStart < existingEnd && requestedEnd > existingStart;
  });
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

  // Non-privileged users (guests) only see their own bookings, filtered by guestEmail.
  // Privileged users (admin/staff/super_admin) and partners see all bookings.
  const filter: Record<string, unknown> =
    !isPrivilegedRole(requester.role as UserRole)
      ? { guestEmail: requester.email }
      : {};

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

// ─── POST / ───────────────────────────────────────────────────────────────────
// Public: unauthenticated guests submit their own name/email/phone in the form.
// No session token required — this is a guest booking website with no login.

bookingRoutes.post('/', async (req, res) => {
  // OWASP A03: strip unexpected fields — only pick known booking fields
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

  // Accept any string for room type and payment method for now
  const roomTypeResult = validateString(body.roomType, 'Room type', 1, 100);
  if (!roomTypeResult.ok) return res.status(400).json({ message: roomTypeResult.message });

  const paymentMethodResult = validateString(body.paymentMethod, 'Payment method', 1, 100);
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

  const adultsResult = validateInteger(body.adults ?? 1, 'Adults', 1, 20);
  if (!adultsResult.ok) return res.status(400).json({ message: adultsResult.message });

  const childrenResult = validateOptionalInteger(body.children, 'Children', 0, 20, 0);
  if (!childrenResult.ok) return res.status(400).json({ message: childrenResult.message });

  const infantsResult = validateOptionalInteger(body.infants, 'Infants', 0, 10, 0);
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
  const discountAmountResult = validatePositiveNumber(body.discountAmount, 'Discount amount', 1_000_000);
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
  const resolvedDiscount = resolveServerDiscount(
    discountReasonResult.value ?? undefined,
    pricing.totalPrice,
    discountAmountResult.value,
  );
  const finalTotalPrice = Math.max(0, pricing.totalPrice - resolvedDiscount);

  console.log(`[MongoDB Action] Collection: bookings, Action: create, Guest: ${guestEmailResult.value}`);
  const booking = await BookingModel.create({
    booking_reference: `BR-${Date.now()}`,
    hotel_id: property.hotel_id,
    room_id: property._id,
    propertyId: propertyIdResult.value,
    propertyName: propertyNameResult.value ?? property.display_name,
    guestName: guestNameResult.value,
    guestEmail: guestEmailResult.value,
    guest_phone: guestPhoneResult.value,
    discount_reason: discountReasonResult.value ?? undefined,
    discount_amount: resolvedDiscount,
    special_requests: specialRequestsResult?.value ?? '',
    promo_code: promoCodeResult?.value ?? '',
    checkInDate: checkInResult.value,
    checkOutDate: checkOutResult.value,
    adults: adultsResult.value,
    children: childrenResult.value,
    infants: infantsResult.value,
    roomType: roomTypeResult.value,
    paymentMethod: paymentMethodResult.value,
    source: 'web',
    booking_type: 'request_to_book',
    nights: pricing.nights,
    guestCount: pricing.guestCount,
    roomRate: pricing.roomRate,
    serviceFee: pricing.serviceFee,
    totalPrice: finalTotalPrice,
    total_amount: finalTotalPrice,
    amountPaid: 0,
    status: 'pending', // Submitted with Pending status
    requestedAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 90_000).toISOString(),
  });
  console.log(`[MongoDB Action] Collection: bookings, Action: create, Success: true, ID: ${booking._id}`);

  // Reflect the booking on the property (room) so it updates in the app immediately
  await PropertyModel.updateOne(
    { _id: property._id },
    {
      $set: {
        status: 'booked',
        current_guest_name: guestNameResult.value,
        current_check_in: new Date(checkInResult.value),
        current_check_out: new Date(checkOutResult.value),
      },
    }
  );
  console.log(`[MongoDB Action] Collection: rooms, Action: updateOne, Success: true, ID: ${property._id}`);

  return res.status(201).json(serializeBooking(booking as never));
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
    const overlap = await hasBookingOverlap(
      booking.propertyId,
      booking.checkInDate,
      booking.checkOutDate,
      String(booking._id),
    );

    booking.status = overlap ? 'declined' : 'accepted';
    console.log(`[MongoDB Action] Collection: bookings, Action: save (update status), ID: ${booking._id}, New Status: ${booking.status}`);
    await booking.save();

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
  // Privileged staff (admin/staff/super_admin) may update any booking.
  const callerRole = (req.auth!.role as UserRole);
  const callerEmail = req.auth!.email.toLowerCase();
  const isStaff = isPrivilegedRole(callerRole);
  const isOwner = booking.guestEmail?.toLowerCase() === callerEmail;

  if (!isStaff && !isOwner) {
    return res.status(403).json({ message: 'Access denied. You may only update your own bookings.' });
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

  console.log(`[MongoDB Action] Collection: bookings, Action: save, ID: ${booking._id}`);
  await booking.save();
  return res.json(serializeBooking(booking.toObject() as never));
});

// ─── POST /:bookingId/retry-confirmation ──────────────────────────────────────
// requireAuth + admin/staff/super_admin only — privileged staff action.

bookingRoutes.post('/:bookingId/retry-confirmation', requireAuth, async (req, res) => {
  if (!req.auth || !isPrivilegedRole(req.auth.role as UserRole)) {
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
  const callerRole = (req.auth!.role as UserRole);
  const callerEmail = req.auth!.email.toLowerCase();
  const isStaff = isPrivilegedRole(callerRole);
  const isOwner = booking.guestEmail?.toLowerCase() === callerEmail;

  if (!isStaff && !isOwner) {
    return res.status(403).json({ message: 'Access denied. You may only cancel your own bookings.' });
  }

  const cancellableStatuses = ['requested', 'accepted', 'pending'];
  if (!cancellableStatuses.includes(booking.status)) {
    return res.status(409).json({ message: `Cannot cancel a booking with status '${booking.status}'.` });
  }

  booking.status = 'declined';
  await booking.save();
  return res.json(serializeBooking(booking.toObject() as never));
});

// ─── GET /:bookingId/receipt ───────────────────────────────────────────────────
// optionalAuth: logged-in users get ownership check; guest-checkout users provide
// their email as a query param to verify ownership without a session cookie.
// This prevents anonymous IDOR lookups while still supporting guest checkout receipts.

bookingRoutes.get('/:bookingId/receipt', optionalAuth, async (req, res) => {
  const bookingIdResult = validateId(req.params.bookingId, 'Booking ID');
  if (!bookingIdResult.ok) return res.status(400).json({ message: bookingIdResult.message });

  const booking = await BookingModel.findById(bookingIdResult.value).lean();
  if (!booking) return res.status(404).json({ message: 'Booking not found.' });

  // ── Ownership check ───────────────────────────────────────────────────────
  // Privileged staff: always allowed.
  if (req.auth && isPrivilegedRole(req.auth.role as UserRole)) {
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

  // Unauthenticated guest-checkout: must supply matching email via ?email= query param.
  // This is the guest's own PII — they are proving they made the booking without a session.
  const rawEmail = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!rawEmail) {
    return res.status(401).json({ message: 'Authentication required. Please sign in or supply your booking email to view this receipt.' });
  }

  const bookingEmail = (booking.guestEmail as string | undefined)?.toLowerCase() ?? '';
  if (rawEmail !== bookingEmail) {
    return res.status(403).json({ message: 'Access denied. The supplied email does not match this booking.' });
  }

  return res.json(serializeBooking(booking as never));
});

export default bookingRoutes;
