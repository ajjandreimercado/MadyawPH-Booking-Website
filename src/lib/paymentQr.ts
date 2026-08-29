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

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export function paymentQrFilename(
  method: WalletPaymentMethod,
  hotelName?: string,
): string {
  const hotel = sanitizeFilenamePart(hotelName || 'madyaw-hotel');
  const wallet = sanitizeFilenamePart(walletMethodLabel(method));
  return `${hotel}-${wallet}-payment-qr.png`;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    || (navigator.maxTouchPoints > 1 && typeof window !== 'undefined' && window.innerWidth < 900);
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

/** Steps shown when the guest pays on the same phone (no second device to scan). */
export function walletPayFromGallerySteps(method: WalletPaymentMethod, amount?: number): string[] {
  const app = walletMethodLabel(method);
  const amountLine = amount != null
    ? `Pay exactly ₱${amount.toLocaleString()}.`
    : 'Pay the deposit amount shown above.';
  const saveHint = isIosDevice()
    ? 'Tap Save QR, then press and hold the image → Add to Photos.'
    : 'Tap Save QR, then press and hold the image → Download image (or use Share).';
  return [
    saveHint,
    `Open ${app} → Pay QR → Upload from gallery (or Scan from photos).`,
    amountLine,
    'Return here to upload your receipt and reference number.',
  ];
}

export function manualQrSaveInstructions(): { title: string; steps: string[] } {
  if (isIosDevice()) {
    return {
      title: 'Save to Photos',
      steps: [
        'Press and hold the QR image below.',
        'Tap Add to Photos (or Save Image).',
        'Open your wallet app and upload the QR from your gallery.',
      ],
    };
  }
  return {
    title: 'Save the QR image',
    steps: [
      'Press and hold the QR image below.',
      'Tap Download image or Save image.',
      'Open your wallet app and upload the QR from your gallery.',
    ],
  };
}

export type SavePaymentQrResult = 'shared' | 'downloaded' | 'manual' | 'failed';

function looksLikeImageBlob(blob: Blob): boolean {
  return blob.type.startsWith('image/')
    || blob.type === 'application/octet-stream'
    || blob.type === ''
    || blob.type === 'binary/octet-stream';
}

async function blobFromSource(source: Blob | string): Promise<Blob | null> {
  if (source instanceof Blob) {
    return source.size >= 32 && looksLikeImageBlob(source) ? source : null;
  }
  try {
    const response = await fetch(source);
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size >= 32 && looksLikeImageBlob(blob) ? blob : null;
  } catch {
    return null;
  }
}

/** Re-encode as PNG so iOS/Android share sheets accept the file reliably. */
export async function normalizePaymentQrBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png' && blob.size >= 32) return blob;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width < 8 || canvas.height < 8) {
        URL.revokeObjectURL(url);
        reject(new Error('Invalid QR dimensions'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (png) => {
          URL.revokeObjectURL(url);
          if (png && png.size >= 32) resolve(png);
          else reject(new Error('PNG export failed'));
        },
        'image/png',
        1,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read QR image'));
    };
    img.src = url;
  });
}

async function tryNativeShare(file: File, method: WalletPaymentMethod): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    const payload: ShareData = {
      files: [file],
      title: `${walletMethodLabel(method)} payment QR`,
    };
    // Many mobile browsers report canShare=false even though file share works.
    if (navigator.canShare && !navigator.canShare(payload) && !isMobileDevice()) {
      return false;
    }
    await navigator.share(payload);
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return false;
  }
}

async function tryAnchorDownload(blob: Blob, filename: string): Promise<boolean> {
  try {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save the payment QR to the device.
 * - Prefers native share sheet on phones (Save to Photos / Save image).
 * - Falls back to download on desktop Android.
 * - Returns `manual` when the UI should show press-and-hold instructions.
 */
export async function savePaymentQrImage(
  source: Blob | string,
  options?: {
    method?: WalletPaymentMethod;
    hotelName?: string;
  },
): Promise<SavePaymentQrResult> {
  const method = options?.method ?? 'gcash';
  const filename = paymentQrFilename(method, options?.hotelName);

  const raw = await blobFromSource(source);
  if (!raw) return 'failed';

  let png: Blob;
  try {
    png = await normalizePaymentQrBlob(raw);
  } catch {
    return 'failed';
  }

  const file = new File([png], filename, { type: 'image/png' });

  if (isMobileDevice()) {
    try {
      const shared = await tryNativeShare(file, method);
      if (shared) return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'failed';
    }
    return 'manual';
  }

  try {
    const shared = await tryNativeShare(file, method);
    if (shared) return 'shared';
  } catch {
    // fall through
  }

  const downloaded = await tryAnchorDownload(png, filename);
  return downloaded ? 'downloaded' : 'manual';
}
