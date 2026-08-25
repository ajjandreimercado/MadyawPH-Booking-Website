import type { BookingPaymentMethod, Hotel } from '../types';
import { API_BASE_URL } from '../services/api';

export function resolveMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const apiBase = API_BASE_URL.replace(/\/$/, '');
  if (url.startsWith('/')) return `${apiBase}${url}`;
  return url;
}

export function qrForMethod(hotel: Hotel | null | undefined, method?: string): string | undefined {
  if (!hotel) return undefined;
  if (hotel.hasPaymentQr) {
    const apiBase = API_BASE_URL.replace(/\/$/, '');
    const params = method ? `?method=${encodeURIComponent(method)}` : '';
    return `${apiBase}/hotels/${encodeURIComponent(hotel.id)}/payment-qr${params}`;
  }
  const qrs = hotel.paymentQrs;
  if (!qrs || !method) return resolveMediaUrl(qrs?.generic);
  const key = method.toLowerCase() as BookingPaymentMethod;
  if (key === 'gcash') return resolveMediaUrl(qrs.gcash || qrs.generic);
  if (key === 'maya') return resolveMediaUrl(qrs.maya || qrs.generic);
  if (key === 'bank-transfer') return resolveMediaUrl(qrs.bank || qrs.generic);
  return resolveMediaUrl(qrs.generic);
}
