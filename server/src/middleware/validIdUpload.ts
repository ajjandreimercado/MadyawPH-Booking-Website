import type { Request, Response } from 'express';
import multer from 'multer';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const BOOKING_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** Local file shape — avoids Express.Multer types (not installed on Render prod builds). */
export interface UploadedBookingFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** @deprecated Use UploadedBookingFile */
export type UploadedValidIdFile = UploadedBookingFile;

export const VALID_ID_MAX_BYTES = BOOKING_UPLOAD_MAX_BYTES;

/** Detect file type from magic bytes (do not trust client Content-Type alone). */
export function detectValidIdMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

function sanitizeFilename(name: string, fallback: string): string {
  return String(name || fallback)
    .replace(/[/\\]/g, '_')
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .slice(0, 180);
}

function finalizeUpload(file: UploadedBookingFile, label: string): UploadedBookingFile {
  const detected = detectValidIdMime(file.buffer);
  if (!detected || !ALLOWED_MIME.has(detected)) {
    throw new Error(`${label} content must be a real JPG, PNG, WEBP, or PDF file.`);
  }
  file.mimetype = detected;
  file.originalname = sanitizeFilename(file.originalname, label.toLowerCase().replace(/\s+/g, '-'));
  return file;
}

const bookingUploads = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BOOKING_UPLOAD_MAX_BYTES, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Uploads must be JPG, PNG, WEBP, or PDF files.'));
      return;
    }
    cb(null, true);
  },
}).fields([
  { name: 'validId', maxCount: 1 },
  { name: 'paymentProof', maxCount: 1 },
]);

type RequestWithFiles = Request & {
  files?: Record<string, UploadedBookingFile[] | undefined>;
};

export interface BookingUploadResult {
  validId?: UploadedBookingFile;
  paymentProof?: UploadedBookingFile;
}

/** Memory upload for guest Valid ID + optional payment proof screenshot. */
export function runBookingUploads(req: Request, res: Response): Promise<BookingUploadResult> {
  return new Promise((resolve, reject) => {
    bookingUploads(req, res, (err: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        const files = (req as RequestWithFiles).files ?? {};
        const validIdRaw = files.validId?.[0];
        const paymentProofRaw = files.paymentProof?.[0];
        resolve({
          validId: validIdRaw ? finalizeUpload(validIdRaw, 'Valid ID') : undefined,
          paymentProof: paymentProofRaw ? finalizeUpload(paymentProofRaw, 'Payment proof') : undefined,
        });
      } catch (finalizeError) {
        reject(finalizeError);
      }
    });
  });
}

/** @deprecated Prefer runBookingUploads — kept for older call sites/tests. */
export function runValidIdUpload(req: Request, res: Response): Promise<UploadedValidIdFile | undefined> {
  return runBookingUploads(req, res).then((result) => result.validId);
}
