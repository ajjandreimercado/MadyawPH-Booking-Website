import type { Hotel } from '../types';
import { API_BASE_URL } from '../services/api';

export type WalletPaymentMethod = 'gcash' | 'maya' | 'qrph';

export const WALLET_PAYMENT_THEME: Record<
  WalletPaymentMethod,
  {
    label: string;
    bookingMethod: 'gcash' | 'maya' | 'qrph';
    color: string;
    activeBorder: string;
    activeBg: string;
    activeText: string;
    inactiveBorder: string;
    inactiveText: string;
    hoverBorder: string;
  }
> = {
  gcash: {
    label: 'GCash',
    bookingMethod: 'gcash',
    color: '#007cff',
    activeBorder: 'border-[#007cff]',
    activeBg: 'bg-[#007cff]/12',
    activeText: 'text-[#007cff]',
    inactiveBorder: 'border-[#007cff]/25',
    inactiveText: 'text-[#007cff]/80',
    hoverBorder: 'hover:border-[#007cff]/55',
  },
  maya: {
    label: 'PayMaya',
    bookingMethod: 'maya',
    color: '#00b451',
    activeBorder: 'border-[#00b451]',
    activeBg: 'bg-[#00b451]/12',
    activeText: 'text-[#00b451]',
    inactiveBorder: 'border-[#00b451]/25',
    inactiveText: 'text-[#00b451]/80',
    hoverBorder: 'hover:border-[#00b451]/55',
  },
  qrph: {
    label: 'QR Ph',
    bookingMethod: 'qrph',
    color: '#1e3a8a',
    activeBorder: 'border-[#1e3a8a]',
    activeBg: 'bg-[#1e3a8a]/12',
    activeText: 'text-[#1e3a8a]',
    inactiveBorder: 'border-[#1e3a8a]/25',
    inactiveText: 'text-[#1e3a8a]/80',
    hoverBorder: 'hover:border-[#1e3a8a]/55',
  },
};

export const WALLET_PAYMENT_OPTIONS = Object.entries(WALLET_PAYMENT_THEME).map(([id, theme]) => ({
  id: id as WalletPaymentMethod,
  ...theme,
}));

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
  return [];
}

export function walletMethodTheme(method: WalletPaymentMethod) {
  return WALLET_PAYMENT_THEME[method];
}

/** The hotel app stores one QR image. Prefer the API-embedded bytes. */
export function hotelPaymentQrSrc(
  hotel: Hotel | null | undefined,
  method: WalletPaymentMethod = 'gcash',
): string | undefined {
  if (!hotel) return undefined;
  const proxy = hotel.paymentQrs?.[method];
  if (proxy) return resolveMediaUrl(proxy);
  return resolveMediaUrl(hotel.paymentQrs?.generic);
}

export function walletMethodLabel(method: WalletPaymentMethod): string {
  return WALLET_PAYMENT_THEME[method]?.label ?? method;
}
