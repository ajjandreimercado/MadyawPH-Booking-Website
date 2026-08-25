import type { BookingPaymentMethod, Hotel } from '../types';
import { API_BASE_URL } from '../services/api';

export function resolveMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const apiBase = API_BASE_URL.replace(/\/$/, '');
  if (url.startsWith('/')) return `${apiBase}${url}`;
  return url;
}

export function paymentQrProxyUrl(hotelId: string, method?: string): string {
  const apiBase = API_BASE_URL.replace(/\/$/, '');
  const params = method ? `?method=${encodeURIComponent(method)}` : '';
  return `${apiBase}/hotels/${encodeURIComponent(hotelId)}/payment-qr${params}`;
}

export function qrForMethod(hotel: Hotel | null | undefined, method?: string): string | undefined {
  if (!hotel) return undefined;
  if (hotel.paymentQrDataUrl) return hotel.paymentQrDataUrl;
  const qrs = hotel.paymentQrs;
  if (!qrs || !method) return resolveMediaUrl(qrs?.generic);
  const key = method.toLowerCase() as BookingPaymentMethod;
  if (key === 'gcash') return resolveMediaUrl(qrs.gcash || qrs.generic);
  if (key === 'maya') return resolveMediaUrl(qrs.maya || qrs.generic);
  if (key === 'bank-transfer') return resolveMediaUrl(qrs.bank || qrs.generic);
  return resolveMediaUrl(qrs.generic);
}
