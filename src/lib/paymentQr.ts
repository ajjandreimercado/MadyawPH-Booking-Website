import type { Hotel } from '../types';
import { API_BASE_URL } from '../services/api';

export type WalletPaymentMethod = 'gcash' | 'maya' | 'qrph';

export const WALLET_PAYMENT_OPTIONS: Array<{
  id: WalletPaymentMethod;
  label: string;
  bookingMethod: 'gcash' | 'maya';
}> = [
  { id: 'gcash', label: 'GCash', bookingMethod: 'gcash' },
  { id: 'maya', label: 'PayMaya', bookingMethod: 'maya' },
  { id: 'qrph', label: 'QR Ph', bookingMethod: 'maya' },
];

export function resolveMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const apiBase = API_BASE_URL.replace(/\/$/, '');
  if (url.startsWith('/')) return `${apiBase}${url}`;
  return url;
}

export function paymentQrProxyUrl(
  hotelId: string,
  method: WalletPaymentMethod = 'gcash',
  refresh = false,
): string {
  const apiBase = API_BASE_URL.replace(/\/$/, '');
  const params = new URLSearchParams({ method });
  if (refresh) params.set('refresh', '1');
  return `${apiBase}/hotels/${encodeURIComponent(hotelId)}/payment-qr?${params.toString()}`;
}

export function availableWalletMethods(hotel: Hotel | null | undefined): WalletPaymentMethod[] {
  if (!hotel) return [];
  if (hotel.paymentMethodsAvailable?.length) {
    return hotel.paymentMethodsAvailable.filter((m): m is WalletPaymentMethod =>
      m === 'gcash' || m === 'maya' || m === 'qrph',
    );
  }
  const methods: WalletPaymentMethod[] = [];
  if (hotel.paymentQrs?.gcash || hotel.paymentQrs?.generic || hotel.hasPaymentQr) methods.push('gcash');
  if (hotel.paymentQrs?.maya || hotel.paymentQrs?.generic || hotel.hasPaymentQr) methods.push('maya');
  if (hotel.paymentQrs?.qrph || hotel.paymentQrs?.generic || hotel.hasPaymentQr) methods.push('qrph');
  return [...new Set(methods)];
}

/** The hotel app stores one QR image. Prefer the API-embedded bytes. */
export function hotelPaymentQrSrc(
  hotel: Hotel | null | undefined,
  method: WalletPaymentMethod = 'gcash',
): string | undefined {
  if (!hotel) return undefined;
  if (hotel.paymentQrDataUrl && method === 'gcash') return hotel.paymentQrDataUrl;
  const proxy = hotel.paymentQrs?.[method];
  if (proxy) return resolveMediaUrl(proxy);
  return resolveMediaUrl(hotel.paymentQrs?.generic || hotel.paymentQrs?.gcash || hotel.paymentQrs?.maya);
}

export function walletMethodLabel(method: WalletPaymentMethod): string {
  return WALLET_PAYMENT_OPTIONS.find((opt) => opt.id === method)?.label ?? method;
}
