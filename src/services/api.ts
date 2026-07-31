import axios, { AxiosError } from 'axios';
import type { BookingDraft } from '../lib/bookingFlow';
import type { BookingPaymentMethod, BookingRequest, BookingRoomType, BookingStatus, Hotel, Property, RoomCategory } from '../types';

export interface ApiListResponse<T> {
  data?: T[];
  items?: T[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

export interface ApiAuthSession {
  token?: string;
  user: {
    id: string;
    email: string;
    name: string;
    role?: string;
    partner?: unknown;
  };
}

export interface PropertyQueryParams {
  hotelId?: string;
  destination?: string;
  priceMin?: number;
  priceMax?: number;
  types?: string[];
  rating?: number;
  amenities?: string[];
  sort?: string;
  page?: number;
  limit?: number;
}

export interface RoomCategoryQueryParams {
  hotelId?: string;
}

export interface HotelDetailCategory extends RoomCategory {
  totalRooms: number;
  availableRooms: number;
  unavailableRooms: number;
  firstAvailableRoomId: string | null;
  fallbackRoomId: string | null;
}

export interface HotelDetailResponse {
  hotel: Hotel;
  categories: HotelDetailCategory[];
  totals: {
    totalCategories: number;
    totalRooms: number;
    availableRooms: number;
    unavailableRooms: number;
  };
}

export interface BookingCreatePayload {
  propertyId: string;
  propertyName: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  infants: number;
  roomType: BookingRoomType;
  paymentMethod: BookingPaymentMethod;
  discountReason?: string;
  discountAmount?: number;
  specialRequests?: string;
  promoCode?: string;
}

export interface BookingUpdatePayload {
  status: BookingStatus;
  paymentMethod?: BookingPaymentMethod;
  booking?: BookingDraft & { nights: number; guestCount: number; roomRate: number; serviceFee: number; totalPrice: number };
}

const PROD_API_URL = 'https://madyaw-api.onrender.com/api';
const DEV_API_URL = '/api'; // Vite proxies /api → localhost:5001 in dev

function resolveApiBaseUrl() {
  // Prefer the explicit env var baked in at build time (set in Render dashboard).
  const viteBaseUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_URL;
  if (viteBaseUrl) return viteBaseUrl;

  // In dev (localhost) use the Vite proxy; in any other environment use the real prod API.
  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  return isLocalhost ? DEV_API_URL : PROD_API_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // send/receive httpOnly auth cookies
  maxRedirects: 0,       // surface 3xx as errors; do NOT silently re-issue POST → GET
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});
// Requests now rely on httpOnly cookies set by the API; do not auto-inject tokens from localStorage.

function normalizeList<T>(payload: T[] | ApiListResponse<T>): T[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  return payload.data ?? payload.items ?? [];
}

function normalizeProperty(property: Property & { _id?: string; id?: string | number }): Property {
  const unwrapDecimal = (value: unknown): number | string => {
    if (value && typeof value === 'object' && '$numberDecimal' in (value as Record<string, unknown>)) {
      const decimalValue = (value as { $numberDecimal?: string }).$numberDecimal;
      return Number(decimalValue ?? 0);
    }

    return value as number | string;
  };

  return {
    ...property,
    id: String(property._id ?? property.id),
    _id: String(property._id ?? property.id),
    price: Number(unwrapDecimal(property.price)),
    rating: Number(unwrapDecimal(property.rating)),
    reviews: Number(unwrapDecimal(property.reviews)),
    distance: String(unwrapDecimal(property.distance)),
    amenities: Array.isArray(property.amenities) ? property.amenities : [],
  };
}

// Token storage removed: server issues httpOnly cookies for auth. Local storage of tokens is unsafe.

function normalizeBookingResponse<T extends BookingRequest>(booking: T & {
  guestPhone?: string;
  discountAmount?: number;
  discountReason?: string;
  totalAmount?: number;
}): T {
  return {
    ...booking,
    id: String(booking.id),
    propertyId: String(booking.propertyId),
    guestPhone: booking.guestPhone ?? (booking as { guest_phone?: string }).guest_phone,
    discountAmount: booking.discountAmount ?? (booking as { discount_amount?: number }).discount_amount,
    discountReason: booking.discountReason ?? (booking as { discount_reason?: string }).discount_reason,
    totalPrice: booking.totalPrice ?? booking.totalAmount,
    confirmationSentAt: booking.confirmationSentAt ?? (booking as { confirmation_sent_at?: string }).confirmation_sent_at ?? null,
    confirmationSendStatus: booking.confirmationSendStatus ?? (booking as { confirmation_send_status?: 'none' | 'sent' | 'failed' }).confirmation_send_status ?? 'none',
    confirmationSendError: booking.confirmationSendError ?? (booking as { confirmation_send_error?: string }).confirmation_send_error ?? '',
  };
}

export async function fetchProperties(params: PropertyQueryParams = {}): Promise<Property[]> {
  const response = await api.get<Property[] | ApiListResponse<Property>>('/properties', {
    params: {
      ...params,
      types: params.types?.join(','),
      amenities: params.amenities?.join(','),
    },
  });

  return normalizeList(response.data).map(normalizeProperty);
}

export async function fetchPropertyById(propertyId: string): Promise<Property> {
  const response = await api.get<Property & { _id?: string; id?: string | number }>(`/properties/${encodeURIComponent(propertyId)}`);
  return normalizeProperty(response.data);
}

export async function loginUser(payload: { email: string; password: string }) {
  const response = await api.post<ApiAuthSession>('/auth/login', payload, { headers: { 'Content-Type': 'application/json' } });
  return response.data;
}

export async function registerUser(payload: { name: string; email: string; password: string }) {
  const response = await api.post<ApiAuthSession>('/auth/register', payload, { headers: { 'Content-Type': 'application/json' } });
  return response.data;
}

export async function loginWithGoogleCredential(credential: string) {
  const response = await api.post<ApiAuthSession>('/auth/google', { credential }, { headers: { 'Content-Type': 'application/json' } });
  return response.data;
}

export async function logoutUser() {
  try {
    await api.post('/auth/logout');
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 401) {
      return;
    }

    throw error;
  }
}

export async function getCurrentUser() {
  const response = await api.get<ApiAuthSession['user']>('/auth/me');
  return response.data;
}

export async function createBookingRequest(payload: BookingCreatePayload) {
  const response = await api.post<BookingRequest>('/bookings', payload);
  return normalizeBookingResponse(response.data);
}

export async function updateBookingRequest(bookingId: string, payload: BookingUpdatePayload) {
  const response = await api.put<BookingRequest>(`/bookings/${encodeURIComponent(bookingId)}`, payload);
  return normalizeBookingResponse(response.data);
}

export async function retryBookingConfirmation(bookingId: string) {
  const response = await api.post<BookingRequest>(`/bookings/${encodeURIComponent(bookingId)}/retry-confirmation`);
  return normalizeBookingResponse(response.data);
}

export interface BookingAvailabilityReviewResponse {
  booking: BookingRequest;
  available: boolean;
  message: string;
}

export async function reviewBookingAvailability(bookingId: string) {
  const response = await api.post<BookingAvailabilityReviewResponse>(
    `/bookings/${encodeURIComponent(bookingId)}/review-availability`,
  );
  return {
    ...response.data,
    booking: normalizeBookingResponse(response.data.booking),
  };
}

export async function fetchBookings(params: { page?: number; limit?: number } = {}): Promise<BookingRequest[]> {
  const response = await api.get<ApiListResponse<BookingRequest> | BookingRequest[]>('/bookings', { params });
  return normalizeList(response.data).map(normalizeBookingResponse);
}

export function isAxiosError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error);
}

function normalizeHotel(hotel: Hotel & { _id?: string; id?: string | number }): Hotel {
  return {
    ...hotel,
    id: String(hotel._id ?? hotel.id),
    contactNumber: hotel.contactNumber ?? '',
    imageUrl: hotel.imageUrl ?? undefined,
  };
}

export async function fetchHotels(): Promise<Hotel[]> {
  const response = await api.get<Hotel[] | ApiListResponse<Hotel>>('/hotels');
  return normalizeList(response.data).map(normalizeHotel);
}

export interface Destination {
  name: string;
  count: number;
  query: string;
}

export async function fetchDestinations(): Promise<Destination[]> {
  const response = await api.get<Destination[]>('/hotels/destinations');
  return response.data;
}

export interface FiltersResponse {
  roomTypes: string[];
  amenities: string[];
}

export async function fetchFilters(): Promise<FiltersResponse> {
  const response = await api.get<FiltersResponse>('/hotels/filters');
  return response.data;
}

export async function fetchHotelById(hotelId: string): Promise<Hotel> {
  const response = await api.get<Hotel & { _id?: string; id?: string | number }>(`/hotels/${encodeURIComponent(hotelId)}`);
  return normalizeHotel(response.data);
}

export async function fetchHotelDetailById(hotelId: string): Promise<HotelDetailResponse> {
  const response = await api.get<HotelDetailResponse>(`/hotels/${encodeURIComponent(hotelId)}/detail`);

  return {
    hotel: normalizeHotel(response.data.hotel),
    categories: response.data.categories.map((category) => ({
      ...normalizeRoomCategory(category),
      totalRooms: Number(category.totalRooms ?? 0),
      availableRooms: Number(category.availableRooms ?? 0),
      unavailableRooms: Number(category.unavailableRooms ?? 0),
      firstAvailableRoomId: category.firstAvailableRoomId ?? null,
      fallbackRoomId: category.fallbackRoomId ?? null,
    })),
    totals: response.data.totals,
  };
}

function normalizeRoomCategory(category: RoomCategory & { _id?: string; id?: string | number }): RoomCategory {
  const unwrapDecimal = (value: unknown): number => {
    if (value && typeof value === 'object' && '$numberDecimal' in (value as Record<string, unknown>)) {
      const decimalValue = (value as { $numberDecimal?: string }).$numberDecimal;
      return Number(decimalValue ?? 0);
    }

    return Number(value ?? 0);
  };

  return {
    ...category,
    id: String(category._id ?? category.id),
    hotelId: String(category.hotelId),
    defaultPrice: unwrapDecimal(category.defaultPrice),
  };
}

export async function fetchRoomCategories(params: RoomCategoryQueryParams = {}): Promise<RoomCategory[]> {
  const response = await api.get<RoomCategory[] | ApiListResponse<RoomCategory>>('/room-categories', {
    params,
  });

  return normalizeList(response.data).map(normalizeRoomCategory);
}

export async function addFavorite(propertyId: string) {
  const response = await api.post('/auth/favorites', { propertyId });
  return response.data;
}

export async function removeFavorite(propertyId: string) {
  const response = await api.delete(`/auth/favorites/${propertyId}`);
  return response.data;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResultHotel {
  id: string;
  name: string;
  location: string;
  city?: string;
  contactNumber: string;
  imageUrl?: string;
  latitude?: number;
  longitude?: number;
  minPrice: number;
  availableRooms: number;
  totalRooms: number;
  images: string[];
  avgRating: number;
  totalReviews: number;
  roomTypes: string[];
  distanceKm?: number;
}

export interface SearchParams {
  destination?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  priceMin?: number;
  priceMax?: number;
  type?: string;
  amenities?: string;
  rating?: number;
  freeCancellation?: boolean;
  breakfastIncluded?: boolean;
  sort?: 'recommended' | 'price' | 'rating' | 'popular' | 'distance';
  page?: number;
  limit?: number;
}

export async function searchHotels(params: SearchParams = {}): Promise<{
  data: SearchResultHotel[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  nearMe?: boolean;
  radiusKm?: number;
}> {
  const response = await api.get('/hotels/search', { params });
  return response.data;
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

export interface Review {
  id: string;
  propertyId: string;
  authorName: string;
  rating: number;
  title: string;
  comment: string;
  createdAt: string;
}

export async function fetchReviews(params: { propertyId?: string; hotelId?: string; page?: number; limit?: number } = {}): Promise<{
  data: Review[];
  total: number;
  totalPages: number;
}> {
  const response = await api.get('/reviews', { params });
  return response.data;
}

export async function createReview(payload: {
  propertyId: string;
  authorName: string;
  rating: number;
  title: string;
  comment: string;
}) {
  const response = await api.post<Review>('/reviews', payload);
  return response.data;
}

// ─── Booking extended ─────────────────────────────────────────────────────────

export async function cancelBooking(bookingId: string): Promise<BookingRequest> {
  const response = await api.delete<BookingRequest>(`/bookings/${encodeURIComponent(bookingId)}`);
  return normalizeBookingResponse(response.data);
}

export async function fetchBookingById(
  bookingId: string,
  guestEmail?: string,
  receiptToken?: string,
): Promise<BookingRequest> {
  const params: Record<string, string> = {};
  // If the caller is not logged in (guest checkout), pass their email so the server can
  // verify ownership without a session cookie (matches the optionalAuth + email-param check).
  if (guestEmail) {
    params.email = guestEmail;
  }
  if (receiptToken) {
    params.token = receiptToken;
  }
  const response = await api.get<BookingRequest>(`/bookings/${encodeURIComponent(bookingId)}/receipt`, { params });
  return normalizeBookingResponse(response.data);
}

// ─── Promo Codes ──────────────────────────────────────────────────────────────

export interface PromoValidationResult {
  valid: boolean;
  code?: string;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  discountAmount?: number;
  description?: string;
  message?: string;
}

export async function validatePromoCode(code: string, bookingAmount: number): Promise<PromoValidationResult> {
  try {
    const response = await api.post<PromoValidationResult>('/promo-codes/validate', { code, bookingAmount });
    return response.data;
  } catch (error) {
    if (isAxiosError(error) && error.response?.data) {
      return error.response.data as PromoValidationResult;
    }
    return { valid: false, message: 'Unable to validate promo code.' };
  }
}

export interface FeaturedPromo {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  description: string;
}

export async function fetchFeaturedPromo(): Promise<FeaturedPromo | null> {
  try {
    const response = await api.get<FeaturedPromo>('/promo-codes/featured');
    return response.data;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    console.error('Error fetching featured promo:', error);
    return null;
  }
}

export interface AdminPromoCode {
  _id?: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  min_booking_amount?: number;
  max_uses?: number;
  uses_count?: number;
  expires_at?: string;
  is_active?: boolean;
  description?: string;
}

export async function fetchAdminPromoCodes(): Promise<AdminPromoCode[]> {
  const response = await api.get<AdminPromoCode[]>('/promo-codes');
  return response.data;
}

export async function createAdminPromoCode(payload: {
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  min_booking_amount?: number;
  max_uses?: number;
  expires_at?: string;
  description?: string;
}): Promise<AdminPromoCode> {
  const response = await api.post<AdminPromoCode>('/promo-codes', payload);
  return response.data;
}

export async function deleteAdminPromoCode(id: string): Promise<void> {
  await api.delete(`/promo-codes/${encodeURIComponent(id)}`);
}

export interface PaymentCheckoutResult {
  enabled: boolean;
  mode: 'live' | 'unavailable';
  checkoutUrl?: string;
  message: string;
}

export async function createPaymentCheckout(bookingId: string, receiptToken?: string): Promise<PaymentCheckoutResult> {
  const response = await api.post<PaymentCheckoutResult>(
    `/bookings/${encodeURIComponent(bookingId)}/payment-checkout`,
    receiptToken ? { token: receiptToken } : {},
  );
  return response.data;
}
