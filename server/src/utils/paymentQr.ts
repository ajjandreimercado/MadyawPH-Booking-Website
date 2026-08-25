/**
 * Reads hotel-app uploaded payment QR images from a shared hotels document
 * or `system_settings` (where the hotel app actually stores `payment_qr_url`).
 */

import mongoose from 'mongoose';

export interface HotelPaymentQrs {
  gcash?: string;
  maya?: string;
  bank?: string;
  generic?: string;
}

export interface HotelPaymentAccounts {
  gcash?: string;
  maya?: string;
  bank?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNested(hotel: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = hotel;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function asImageUrl(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (
      trimmed.startsWith('http://')
      || trimmed.startsWith('https://')
      || trimmed.startsWith('data:image/')
      || trimmed.startsWith('/')
      || /^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(png|jpe?g|webp|gif|svg)$/i.test(trimmed)
      || trimmed.startsWith('payment-qr/')
      || trimmed.startsWith('platform-qr/')
      || trimmed.startsWith('storage/')
    ) {
      return trimmed;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;
  return asImageUrl(
    record.url
    ?? record.src
    ?? record.path
    ?? record.image
    ?? record.image_url
    ?? record.imageUrl
    ?? record.qr
    ?? record.qr_url
    ?? record.qrUrl
    ?? record.file
    ?? record.data
  );
}

function asAccountLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

const GCASH_QR_PATHS: string[][] = [
  ['gcash_qr'],
  ['gcash_qr_url'],
  ['gcashQr'],
  ['gcashQrUrl'],
  ['gcash_qr_image'],
  ['gcash_qr_image_url'],
  ['gcash_payment_qr'],
  ['payment_qr_gcash'],
  ['qr_gcash'],
  ['gcash', 'qr'],
  ['gcash', 'qr_url'],
  ['payment_settings', 'gcash_qr'],
  ['payment_settings', 'gcash_qr_url'],
  ['payment_settings', 'gcash'],
  ['paymentSettings', 'gcash_qr'],
  ['paymentSettings', 'gcash'],
  ['settings', 'gcash_qr'],
  ['settings', 'gcash_qr_url'],
  ['qr_codes', 'gcash'],
  ['qrCodes', 'gcash'],
  ['payment_methods', 'gcash'],
  ['paymentMethods', 'gcash'],
];

const MAYA_QR_PATHS: string[][] = [
  ['maya_qr'],
  ['maya_qr_url'],
  ['mayaQr'],
  ['paymaya_qr'],
  ['paymaya_qr_url'],
  ['maya_qr_image'],
  ['maya_payment_qr'],
  ['payment_qr_maya'],
  ['qr_maya'],
  ['maya', 'qr'],
  ['maya', 'qr_url'],
  ['payment_settings', 'maya_qr'],
  ['payment_settings', 'maya_qr_url'],
  ['payment_settings', 'maya'],
  ['payment_settings', 'paymaya_qr'],
  ['paymentSettings', 'maya_qr'],
  ['paymentSettings', 'maya'],
  ['settings', 'maya_qr'],
  ['settings', 'paymaya_qr'],
  ['qr_codes', 'maya'],
  ['qrCodes', 'maya'],
  ['payment_methods', 'maya'],
  ['paymentMethods', 'maya'],
];

const BANK_QR_PATHS: string[][] = [
  ['bank_qr'],
  ['bank_qr_url'],
  ['bank_transfer_qr'],
  ['bankTransferQr'],
  ['qr_bank'],
  ['payment_settings', 'bank_qr'],
  ['payment_settings', 'bank_transfer_qr'],
  ['settings', 'bank_qr'],
  ['qr_codes', 'bank'],
  ['payment_methods', 'bank'],
  ['paymentMethods', 'bank_transfer'],
];

const GENERIC_QR_PATHS: string[][] = [
  ['payment_qr'],
  ['payment_qr_url'],
  ['paymentQr'],
  ['paymentQrUrl'],
  ['qr_code'],
  ['qr_code_url'],
  ['qrCode'],
  ['qr_image'],
  ['qrImage'],
  ['qr_url'],
  ['qrUrl'],
  ['online_payment_qr'],
  ['onlinePaymentQr'],
  ['payment_settings', 'qr'],
  ['payment_settings', 'qr_url'],
  ['payment_settings', 'payment_qr'],
  ['paymentSettings', 'qr'],
  ['settings', 'payment_qr'],
  ['settings', 'qr_code'],
  ['settings', 'qr'],
];

function firstUrl(hotel: Record<string, unknown>, paths: string[][]): string | undefined {
  for (const path of paths) {
    const url = asImageUrl(readNested(hotel, path));
    if (url) return url;
  }
  return undefined;
}

export function resolveHotelPaymentQrs(hotel: unknown): HotelPaymentQrs {
  const record = asRecord(hotel);
  if (!record) return {};

  const gcash = firstUrl(record, GCASH_QR_PATHS);
  const maya = firstUrl(record, MAYA_QR_PATHS);
  const bank = firstUrl(record, BANK_QR_PATHS);
  const generic = firstUrl(record, GENERIC_QR_PATHS);

  const qrs: HotelPaymentQrs = {};
  if (gcash) qrs.gcash = gcash;
  if (maya) qrs.maya = maya;
  if (bank) qrs.bank = bank;
  if (generic) qrs.generic = generic;
  return qrs;
}

export function resolveHotelPaymentAccounts(hotel: unknown): HotelPaymentAccounts {
  const record = asRecord(hotel);
  if (!record) return {};

  const gcash = asAccountLabel(
    readNested(record, ['gcash_number'])
    ?? readNested(record, ['gcash_account'])
    ?? readNested(record, ['payment_gcash_mobile'])
    ?? readNested(record, ['payment_settings', 'gcash_number'])
    ?? readNested(record, ['settings', 'gcash_number']),
  );
  const maya = asAccountLabel(
    readNested(record, ['maya_number'])
    ?? readNested(record, ['paymaya_number'])
    ?? readNested(record, ['payment_maya_mobile'])
    ?? readNested(record, ['payment_settings', 'maya_number']),
  );
  const bank = asAccountLabel(
    readNested(record, ['bank_account'])
    ?? readNested(record, ['bank_details'])
    ?? readNested(record, ['payment_settings', 'bank_account']),
  );

  const accounts: HotelPaymentAccounts = {};
  if (gcash) accounts.gcash = gcash;
  if (maya) accounts.maya = maya;
  if (bank) accounts.bank = bank;
  return accounts;
}

export function qrUrlForPaymentMethod(
  qrs: HotelPaymentQrs | undefined,
  method: string,
): string | undefined {
  if (!qrs) return undefined;
  const key = method.trim().toLowerCase();
  if (key === 'gcash') return qrs.gcash || qrs.generic;
  if (key === 'maya' || key === 'paymaya') return qrs.maya || qrs.generic;
  if (key === 'bank-transfer' || key === 'bank_transfer' || key === 'bank') {
    return qrs.bank || qrs.generic;
  }
  return qrs.generic;
}

export function mergePaymentQrs(...docs: unknown[]): HotelPaymentQrs {
  const merged: HotelPaymentQrs = {};
  for (const doc of docs) {
    const next = resolveHotelPaymentQrs(doc);
    if (next.gcash) merged.gcash = next.gcash;
    if (next.maya) merged.maya = next.maya;
    if (next.bank) merged.bank = next.bank;
    if (next.generic) merged.generic = next.generic;
  }
  return merged;
}

export function mergePaymentAccounts(...docs: unknown[]): HotelPaymentAccounts {
  const merged: HotelPaymentAccounts = {};
  for (const doc of docs) {
    const next = resolveHotelPaymentAccounts(doc);
    if (next.gcash) merged.gcash = next.gcash;
    if (next.maya) merged.maya = next.maya;
    if (next.bank) merged.bank = next.bank;
  }
  return merged;
}

export function hasAnyPaymentQr(qrs: HotelPaymentQrs): boolean {
  return Boolean(qrs.gcash || qrs.maya || qrs.bank || qrs.generic);
}

export async function loadHotelSystemSettings(hotelId: string): Promise<Record<string, unknown> | null> {
  const db = mongoose.connection.db;
  if (!db || !hotelId) return null;

  const clauses: Record<string, unknown>[] = [{ hotel_id: hotelId }];
  if (mongoose.isValidObjectId(hotelId)) {
    clauses.push({ hotel_id: new mongoose.Types.ObjectId(hotelId) });
  }

  const doc = await db.collection('system_settings').findOne({ $or: clauses });
  return doc ? (doc as Record<string, unknown>) : null;
}

export function sanitizeStoragePath(raw: string): string | null {
  let path = raw.trim().replace(/\\/g, '/');
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path;
  }
  path = path.replace(/^\/+/, '');
  if (path.startsWith('storage/')) path = path.slice('storage/'.length);
  if (!path || path.includes('..') || path.includes(':')) return null;
  if (!/^[a-zA-Z0-9._/-]+$/.test(path)) return null;
  return path;
}

function storageFetchUrls(rawPath: string): string[] {
  const urls: string[] = [];
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    urls.push(rawPath);
    return urls;
  }
  const path = sanitizeStoragePath(rawPath);
  if (!path) return [];
  const storage = (process.env.HOTEL_STORAGE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  const app = (process.env.HOTEL_APP_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (storage) urls.push(`${storage}/${path}`);
  if (app) {
    urls.push(`${app}/storage/${path}`);
    urls.push(`${app}/${path}`);
  }
  return urls;
}

export async function fetchHotelPaymentQrImage(rawPath: string): Promise<{ body: Buffer; contentType: string } | null> {
  const candidates = storageFetchUrls(rawPath);
  for (const url of candidates) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) continue;
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length < 32) continue;
      return { body, contentType: contentType.startsWith('image/') ? contentType : 'image/jpeg' };
    } catch {
      // try next candidate
    }
  }
  return null;
}
