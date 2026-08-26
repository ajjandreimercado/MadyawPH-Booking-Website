/**
 * Reads hotel-app uploaded payment QR images from a shared hotels document
 * or `system_settings` (where the hotel app actually stores `payment_qr_url`).
 */

import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';

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
  if (!qrs.generic) {
    const embedded = blobToBuffer(record.payment_qr ?? record.qr_image ?? record.qrImage);
    if (embedded) {
      qrs.generic = `data:image/jpeg;base64,${embedded.toString('base64')}`;
    }
  }
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

  for (const name of ['system_settings', 'systemsettings']) {
    const doc = await db.collection(name).findOne({ $or: clauses });
    if (doc) return doc as Record<string, unknown>;
  }
  return null;
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

const DEFAULT_HOTEL_APP_ORIGIN = 'https://madyawph.onrender.com';

function looksLikeImage(body: Buffer, contentType: string): boolean {
  if (body.length < 32) return false;
  const jpeg = body[0] === 0xff && body[1] === 0xd8;
  const png = body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
  const gif = body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46;
  const webp = body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50;
  if (jpeg || png || gif || webp) return true;
  return contentType.startsWith('image/') || contentType.includes('octet-stream');
}

function storageFetchUrls(rawPath: string): string[] {
  const urls: string[] = [];
  const override = (process.env.HOTEL_PAYMENT_QR_URL ?? '').trim();
  if (override.startsWith('http://') || override.startsWith('https://')) {
    urls.push(override);
  }
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    urls.push(rawPath);
    return [...new Set(urls)];
  }
  const storagePath = sanitizeStoragePath(rawPath);
  if (!storagePath) return [...new Set(urls)];
  const storage = (process.env.HOTEL_STORAGE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  const app = (process.env.HOTEL_APP_PUBLIC_URL ?? DEFAULT_HOTEL_APP_ORIGIN).trim().replace(/\/+$/, '');
  const internal = (process.env.HOTEL_APP_INTERNAL_URL ?? '').trim().replace(/\/+$/, '');
  const extras = (process.env.HOTEL_APP_PUBLIC_URLS ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const localBases = process.env.NODE_ENV === 'production'
    ? []
    : ['http://127.0.0.1:8000', 'http://localhost:8000'];
  const bases = [...new Set([storage, app, internal, ...extras, ...localBases].filter(Boolean))];
  for (const base of bases) {
    if (base === storage && storage) {
      urls.push(`${storage}/${storagePath}`);
      continue;
    }
    urls.push(`${base}/storage/${storagePath}`);
    urls.push(`${base}/${storagePath}`);
    urls.push(`${base}/public/storage/${storagePath}`);
    urls.push(`${base}/storage/app/public/${storagePath}`);
  }
  return [...new Set(urls)];
}

async function readQrFromDisk(storagePath: string): Promise<Buffer | null> {
  const roots = [
    (process.env.HOTEL_STORAGE_PATH ?? '').trim(),
    path.resolve(process.cwd(), 'storage/app/public'),
    path.resolve(process.cwd(), '../storage/app/public'),
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = path.resolve(root, storagePath);
    if (!candidate.startsWith(path.resolve(root))) continue;
    try {
      const buf = await fs.readFile(candidate);
      if (buf.length >= 32) return buf;
    } catch {
      // try next root
    }
  }
  return null;
}

function blobToBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.length >= 32 ? value : null;
  if (value instanceof Uint8Array) return value.length >= 32 ? Buffer.from(value) : null;
  if (value instanceof mongoose.mongo.Binary) {
    const buf = Buffer.from(value.buffer);
    return buf.length >= 32 ? buf : null;
  }
  if (typeof value === 'object' && value) {
    const rec = value as { buffer?: unknown; _bsontype?: string };
    if (Buffer.isBuffer(rec.buffer)) return rec.buffer.length >= 32 ? rec.buffer : null;
    if (rec.buffer instanceof Uint8Array) {
      return rec.buffer.length >= 32 ? Buffer.from(rec.buffer) : null;
    }
  }
  if (typeof value === 'string' && value.length > 64) {
    const trimmed = value.startsWith('data:image/') ? value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '') : value;
    try {
      const buf = Buffer.from(trimmed, 'base64');
      return buf.length >= 32 ? buf : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseDataUrl(raw: string): { body: Buffer; contentType: string } | null {
  const match = raw.trim().match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const body = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  return body.length >= 32 ? { body, contentType: match[1] } : null;
}

async function readCachedQr(hotelId: string, storagePath: string): Promise<{ body: Buffer; contentType: string } | null> {
  const settings = await loadHotelSystemSettings(hotelId);
  if (!settings) return null;
  const cachedPath = typeof settings.payment_qr_blob_path === 'string' ? settings.payment_qr_blob_path : '';
  if (cachedPath && cachedPath !== storagePath) return null;
  const body = blobToBuffer(settings.payment_qr_blob ?? settings.payment_qr_base64);
  if (!body) return null;
  const contentType = typeof settings.payment_qr_blob_type === 'string' ? settings.payment_qr_blob_type : 'image/jpeg';
  return { body, contentType };
}

async function writeCachedQr(hotelId: string, storagePath: string, image: { body: Buffer; contentType: string }): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  const clauses: Record<string, unknown>[] = [{ hotel_id: hotelId }];
  if (mongoose.isValidObjectId(hotelId)) {
    clauses.push({ hotel_id: new mongoose.Types.ObjectId(hotelId) });
  }
  for (const name of ['system_settings', 'systemsettings']) {
    const result = await db.collection(name).updateOne(
      { $or: clauses },
      {
        $set: {
          payment_qr_blob: new mongoose.mongo.Binary(image.body),
          payment_qr_blob_type: image.contentType,
          payment_qr_blob_path: storagePath,
        },
      },
    );
    if (result.matchedCount > 0) return;
  }
}

export async function fetchHotelPaymentQrImage(rawPath: string, hotelId?: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (rawPath.startsWith('data:image/')) {
    return parseDataUrl(rawPath);
  }

  const storagePath = rawPath.startsWith('http')
    ? rawPath
    : sanitizeStoragePath(rawPath);
  if (!storagePath) return null;

  if (hotelId && !storagePath.startsWith('http')) {
    const cached = await readCachedQr(hotelId, storagePath);
    if (cached) return cached;
    const fromDisk = await readQrFromDisk(storagePath);
    if (fromDisk) {
      const image = { body: fromDisk, contentType: storagePath.endsWith('.png') ? 'image/png' : 'image/jpeg' };
      await writeCachedQr(hotelId, storagePath, image).catch(() => undefined);
      return image;
    }
  }

  const candidates = storageFetchUrls(rawPath);
  for (const url of candidates) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(25000),
          headers: { Accept: 'image/*,*/*' },
        });
        if (response.status === 503 || response.status === 502) {
          await new Promise((resolve) => setTimeout(resolve, 4000));
          continue;
        }
        break;
      }
      if (!response || !response.ok) continue;
      const contentType = response.headers.get('content-type') ?? '';
      const body = Buffer.from(await response.arrayBuffer());
      if (!looksLikeImage(body, contentType)) continue;
      const image = {
        body,
        contentType: contentType.startsWith('image/')
          ? contentType.split(';')[0]
          : body[0] === 0x89 ? 'image/png' : 'image/jpeg',
      };
      if (hotelId && !storagePath.startsWith('http')) {
        await writeCachedQr(hotelId, storagePath, image).catch(() => undefined);
      }
      return image;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function paymentQrToDataUrl(image: { body: Buffer; contentType: string }): string {
  return `data:${image.contentType};base64,${image.body.toString('base64')}`;
}

export async function resolveDisplayablePaymentQr(
  hotel: unknown,
  systemSettings: unknown,
  hotelId: string,
): Promise<string | undefined> {
  const qrs = mergePaymentQrs(hotel, systemSettings);
  const raw = qrs.generic || qrs.gcash || qrs.maya || qrs.bank;
  if (!raw) return undefined;
  if (raw.startsWith('data:image/')) return raw;
  const image = await fetchHotelPaymentQrImage(raw, hotelId);
  return image ? paymentQrToDataUrl(image) : undefined;
}
