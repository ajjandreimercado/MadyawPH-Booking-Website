/**
 * Reads hotel-app uploaded payment QR images from a shared hotels document
 * or `system_settings` (where the hotel app actually stores `payment_qr_url`).
 */

import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getHotelAppPublicUrl, getHotelStoragePublicUrl } from '../config/env';

export interface HotelPaymentQrs {
  gcash?: string;
  maya?: string;
  qrph?: string;
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

function parsePaymentMethodQrs(record: Record<string, unknown> | null): HotelPaymentQrs {
  if (!record) return {};
  const raw = record.payment_method_qrs;
  let parsed: Record<string, unknown> | null = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  } else {
    parsed = asRecord(raw);
  }
  if (!parsed) return {};

  const qrs: HotelPaymentQrs = {};
  for (const [key, value] of Object.entries(parsed)) {
    const entry = asRecord(value);
    if (!entry) continue;
    const url = asImageUrl(entry.qr_url ?? entry.qrUrl ?? entry.url ?? entry.qr);
    const embedded = blobToBuffer(entry.qr_base64 ?? entry.base64);
    if (!url && embedded) {
      const dataUrl = `data:image/jpeg;base64,${embedded.toString('base64')}`;
      const normalized = key.toLowerCase();
      if (normalized.includes('gcash')) qrs.gcash = dataUrl;
      else if (normalized.includes('maya') || normalized.includes('paymaya')) qrs.maya = dataUrl;
      else if (normalized.includes('qrph') || normalized.includes('qr-ph') || normalized.includes('qr_ph')) qrs.qrph = dataUrl;
      else if (normalized.includes('bank')) qrs.bank = dataUrl;
      else if (!qrs.generic) qrs.generic = dataUrl;
      continue;
    }
    if (!url) continue;
    const normalized = key.toLowerCase();
    if (normalized.includes('gcash')) qrs.gcash = url;
    else if (normalized.includes('maya') || normalized.includes('paymaya')) qrs.maya = url;
    else if (normalized.includes('qrph') || normalized.includes('qr-ph') || normalized.includes('qr_ph')) qrs.qrph = url;
    else if (normalized.includes('bank')) qrs.bank = url;
    else if (!qrs.generic) qrs.generic = url;
  }
  return qrs;
}

/** All QR paths to try, newest/method-specific first. */
export function collectPaymentQrCandidates(hotel: unknown, systemSettings?: unknown): string[] {
  const settingsRecord = asRecord(systemSettings);
  const methodQrs = parsePaymentMethodQrs(settingsRecord);
  const merged = mergePaymentQrs(hotel, systemSettings, methodQrs);
  const ordered = [
    merged.maya,
    merged.gcash,
    merged.qrph,
    merged.bank,
    merged.generic,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(ordered)];
}

export async function fetchFirstPaymentQrImage(
  hotel: unknown,
  systemSettings: unknown,
  hotelId: string,
  options?: { skipCache?: boolean; preferredMethod?: string },
): Promise<{ body: Buffer; contentType: string; path: string } | null> {
  if (!options?.skipCache && !options?.preferredMethod) {
    const hotelCache = await readCachedQrForHotel(hotelId);
    if (hotelCache) {
      return { ...hotelCache, path: hotelCache.path ?? 'cached' };
    }
  }

  const qrs = mergePaymentQrs(hotel, systemSettings, parsePaymentMethodQrs(asRecord(systemSettings)));

  if (options?.preferredMethod) {
    const preferred = qrUrlForPaymentMethod(qrs, options.preferredMethod);
    if (!preferred) return null;
    const rawCandidates = [preferred];
    for (const raw of rawCandidates) {
      if (raw.startsWith('data:image/')) {
        const parsed = parseDataUrl(raw);
        if (parsed) return { ...parsed, path: raw };
      }
      const image = await fetchHotelPaymentQrImage(raw, hotelId, { ...options, skipCache: options.skipCache });
      if (image) return { ...image, path: raw };
    }
    return null;
  }

  const candidates = collectPaymentQrCandidates(
    hotel,
    mergePaymentQrs(systemSettings, parsePaymentMethodQrs(asRecord(systemSettings))),
  );

  for (const raw of candidates) {
    if (raw.startsWith('data:image/')) {
      const parsed = parseDataUrl(raw);
      if (parsed) return { ...parsed, path: raw };
    }
    const image = await fetchHotelPaymentQrImage(raw, hotelId, options);
    if (image) return { ...image, path: raw };
  }
  return null;
}

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
  const methodQrs = parsePaymentMethodQrs(record);
  if (methodQrs.gcash) qrs.gcash = methodQrs.gcash;
  if (methodQrs.maya) qrs.maya = methodQrs.maya;
  if (methodQrs.qrph) qrs.qrph = methodQrs.qrph;
  if (methodQrs.bank) qrs.bank = methodQrs.bank;
  if (methodQrs.generic && !qrs.generic) qrs.generic = methodQrs.generic;
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

export function qrPathForMethodOnly(qrs: HotelPaymentQrs, method: string): string | undefined {
  const key = method.trim().toLowerCase();
  if (key === 'gcash') return qrs.gcash;
  if (key === 'maya' || key === 'paymaya') return qrs.maya;
  if (key === 'qrph' || key === 'qr-ph' || key === 'qr_ph') return qrs.qrph;
  return undefined;
}

export function qrUrlForPaymentMethod(
  qrs: HotelPaymentQrs | undefined,
  method: string,
): string | undefined {
  if (!qrs) return undefined;
  const dedicated = qrPathForMethodOnly(qrs, method);
  if (dedicated) return dedicated;
  const key = method.trim().toLowerCase();
  if (key === 'gcash') return qrs.generic;
  if (key === 'maya' || key === 'paymaya') return qrs.generic;
  if (key === 'qrph' || key === 'qr-ph' || key === 'qr_ph') return qrs.generic;
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
    if (next.qrph) merged.qrph = next.qrph;
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
  return Boolean(qrs.gcash || qrs.maya || qrs.qrph || qrs.bank || qrs.generic);
}

export type WalletQrMethod = 'gcash' | 'maya' | 'qrph';

const WALLET_QR_METHODS: WalletQrMethod[] = ['gcash', 'maya', 'qrph'];

/** Wallet methods the guest can pick — only methods with their own QR, or all three if one generic QR. */
export function listAvailableWalletMethods(qrs: HotelPaymentQrs): WalletQrMethod[] {
  const dedicated = WALLET_QR_METHODS.filter((method) => Boolean(qrPathForMethodOnly(qrs, method)));
  if (dedicated.length > 0) return dedicated;
  if (qrs.generic) return [...WALLET_QR_METHODS];
  return [];
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

function looksLikeImage(body: Buffer, contentType: string): boolean {
  if (body.length < 32) return false;
  const jpeg = body[0] === 0xff && body[1] === 0xd8;
  const png = body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
  const gif = body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46;
  const webp = body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50;
  if (jpeg || png || gif || webp) return true;
  return contentType.startsWith('image/') || contentType.includes('octet-stream');
}

function hotelAppOrigins(): string[] {
  const app = (getHotelAppPublicUrl() || 'https://madyawph.onrender.com').replace(/\/+$/, '');
  const storage = (getHotelStoragePublicUrl() || `${app}/uploads`).replace(/\/+$/, '');
  const internal = (process.env.HOTEL_APP_INTERNAL_URL ?? '').trim().replace(/\/+$/, '');
  const extras = (process.env.HOTEL_APP_PUBLIC_URLS ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const localBases = process.env.NODE_ENV === 'production'
    ? []
    : ['http://127.0.0.1:8000', 'http://localhost:8000'];
  return [...new Set([storage, app, internal, ...extras, ...localBases].filter(Boolean))];
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

  const appBase = (getHotelAppPublicUrl() || 'https://madyawph.onrender.com').replace(/\/+$/, '');
  const storage = getHotelStoragePublicUrl() || `${appBase}/uploads`;
  const pathSuffixes = [
    `/storage/${storagePath}`,
    `/public/storage/${storagePath}`,
    `/storage/app/public/${storagePath}`,
    `/uploads/${storagePath}`,
    `/${storagePath}`,
  ];

  const roots = new Set<string>();
  for (const base of hotelAppOrigins()) {
    roots.add(base.replace(/\/api$/, ''));
  }

  for (const root of roots) {
    for (const suffix of pathSuffixes) {
      urls.push(`${root}${suffix}`);
    }
    // Laravel API-only deployments sometimes expose files under /api/…
    urls.push(`${root}/api/storage/${storagePath}`);
    urls.push(`${root}/api/public/storage/${storagePath}`);
    urls.push(`${root}/api/files/${storagePath}`);
    urls.push(`${root}/api/v1/chat/media?f=${encodeURIComponent(storagePath)}`);
  }

  urls.push(`${storage.replace(/\/+$/, '')}/${storagePath}`);

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

async function readCachedQr(
  hotelId: string,
  storagePath: string,
): Promise<{ body: Buffer; contentType: string; path?: string } | null> {
  const settings = await loadHotelSystemSettings(hotelId);
  if (!settings) return null;
  const body = blobToBuffer(settings.payment_qr_blob ?? settings.payment_qr_base64);
  if (!body) return null;
  const cachedPath = typeof settings.payment_qr_blob_path === 'string' ? settings.payment_qr_blob_path : '';
  const currentPath = typeof settings.payment_qr_url === 'string'
    ? sanitizeStoragePath(settings.payment_qr_url)
    : null;
  if (cachedPath && cachedPath !== storagePath && currentPath !== storagePath) {
    return null;
  }
  const contentType = typeof settings.payment_qr_blob_type === 'string' ? settings.payment_qr_blob_type : 'image/jpeg';
  return { body, contentType, path: cachedPath || storagePath };
}

/** Cached bytes in system_settings — works when the hotel disk file is not public HTTP yet. */
async function readCachedQrForHotel(
  hotelId: string,
): Promise<{ body: Buffer; contentType: string; path?: string } | null> {
  const settings = await loadHotelSystemSettings(hotelId);
  if (!settings) return null;
  const body = blobToBuffer(settings.payment_qr_blob ?? settings.payment_qr_base64);
  if (!body) return null;
  const contentType = typeof settings.payment_qr_blob_type === 'string'
    ? settings.payment_qr_blob_type
    : 'image/jpeg';
  const cachedPath = typeof settings.payment_qr_blob_path === 'string'
    ? settings.payment_qr_blob_path
    : undefined;
  return { body, contentType, path: cachedPath };
}

export async function cachePaymentQrFromBase64(
  hotelId: string,
  storagePath: string,
  rawBase64: string,
  mime = 'image/jpeg',
): Promise<boolean> {
  const payload = rawBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
  if (!payload) return false;
  const body = Buffer.from(payload, 'base64');
  if (body.length < 32) return false;
  const contentType = mime.startsWith('image/') ? mime.split(';')[0] : 'image/jpeg';
  await cachePaymentQrImage(hotelId, storagePath, { body, contentType });
  return true;
}

const warmInFlight = new Map<string, Promise<void>>();
const warmLastAttempt = new Map<string, number>();
const WARM_DEBOUNCE_MS = 45_000;

/** Background fetch from hotel public URL when disk file becomes reachable. */
export function schedulePaymentQrWarm(
  hotelId: string,
  hotel: unknown,
  systemSettings: unknown,
): void {
  if (!hotelId || !collectPaymentQrCandidates(hotel, systemSettings).length) return;
  const last = warmLastAttempt.get(hotelId) ?? 0;
  if (Date.now() - last < WARM_DEBOUNCE_MS) return;
  if (warmInFlight.has(hotelId)) return;
  warmLastAttempt.set(hotelId, Date.now());
  const job = fetchFirstPaymentQrImage(hotel, systemSettings, hotelId, { skipCache: true })
    .then((image) => {
      if (image && !image.path.startsWith('data:')) {
        console.log(`[PaymentQR] Warmed cache for hotel ${hotelId} from ${image.path}`);
      }
    })
    .catch(() => undefined)
    .finally(() => warmInFlight.delete(hotelId));
  warmInFlight.set(hotelId, job);
}

export async function cachePaymentQrImage(
  hotelId: string,
  storagePath: string,
  image: { body: Buffer; contentType: string },
): Promise<void> {
  await writeCachedQr(hotelId, storagePath, image);
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

export async function fetchHotelPaymentQrImage(
  rawPath: string,
  hotelId?: string,
  options?: { skipCache?: boolean },
): Promise<{ body: Buffer; contentType: string } | null> {
  if (rawPath.startsWith('data:image/')) {
    return parseDataUrl(rawPath);
  }

  const storagePath = rawPath.startsWith('http')
    ? rawPath
    : sanitizeStoragePath(rawPath);
  if (!storagePath) return null;

  if (hotelId && !storagePath.startsWith('http') && !options?.skipCache) {
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

/** Try every hotel with a payment QR path in system_settings. */
export async function warmAllPaymentQrCaches(): Promise<Array<{ hotelId: string; ok: boolean; path: string }>> {
  const db = mongoose.connection.db;
  if (!db) return [];
  const rows = await db.collection('system_settings').find({}).toArray();
  const results: Array<{ hotelId: string; ok: boolean; path: string }> = [];
  for (const row of rows) {
    const hotelId = String(row.hotel_id ?? '');
    if (!hotelId) continue;
    const candidates = collectPaymentQrCandidates({}, row);
    if (!candidates.length) continue;
    const image = await fetchFirstPaymentQrImage({}, row, hotelId, { skipCache: true });
    results.push({
      hotelId,
      ok: Boolean(image),
      path: image?.path ?? candidates[0],
    });
  }
  return results;
}

export function paymentQrToDataUrl(image: { body: Buffer; contentType: string }): string {
  return `data:${image.contentType};base64,${image.body.toString('base64')}`;
}

export async function resolveDisplayablePaymentQr(
  hotel: unknown,
  systemSettings: unknown,
  hotelId: string,
): Promise<string | undefined> {
  const image = await fetchFirstPaymentQrImage(hotel, systemSettings, hotelId);
  return image ? paymentQrToDataUrl(image) : undefined;
}
