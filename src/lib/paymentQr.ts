import type { Hotel } from '../types';
import { API_BASE_URL } from '../services/api';

export function resolveMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const apiBase = API_BASE_URL.replace(/\/$/, '');
  if (url.startsWith('/')) return `${apiBase}${url}`;
  return url;
}

export function paymentQrProxyUrl(hotelId: string): string {
  const apiBase = API_BASE_URL.replace(/\/$/, '');
  return `${apiBase}/hotels/${encodeURIComponent(hotelId)}/payment-qr`;
}

/** The hotel app stores one QR image. Prefer the API-embedded bytes. */
export function hotelPaymentQrSrc(hotel: Hotel | null | undefined): string | undefined {
  if (!hotel) return undefined;
  if (hotel.paymentQrDataUrl) return hotel.paymentQrDataUrl;
  return resolveMediaUrl(hotel.paymentQrs?.generic || hotel.paymentQrs?.gcash || hotel.paymentQrs?.maya || hotel.paymentQrs?.bank);
}
