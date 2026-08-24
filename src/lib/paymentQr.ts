import type { BookingPaymentMethod, Hotel } from '../types';

export function resolveMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  if (url.startsWith('/') && apiBase) return `${apiBase}${url}`;
  return url;
}

export function qrForMethod(hotel: Hotel | null | undefined, method?: string): string | undefined {
  const qrs = hotel?.paymentQrs;
  if (!qrs || !method) return undefined;
  const key = method.toLowerCase() as BookingPaymentMethod;
  if (key === 'gcash') return resolveMediaUrl(qrs.gcash || qrs.generic);
  if (key === 'maya') return resolveMediaUrl(qrs.maya || qrs.generic);
  if (key === 'bank-transfer') return resolveMediaUrl(qrs.bank || qrs.generic);
  return resolveMediaUrl(qrs.generic);
}
