import multer from 'multer';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const VALID_ID_MAX_BYTES = 5 * 1024 * 1024;

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

/** Memory upload for guest Valid ID (stored on the booking in shared Mongo). */
export const validIdUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VALID_ID_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Valid ID must be a JPG, PNG, WEBP, or PDF file.'));
      return;
    }
    cb(null, true);
  },
}).single('validId');

export function runValidIdUpload(req: Parameters<typeof validIdUpload>[0], res: Parameters<typeof validIdUpload>[1]): Promise<Express.Multer.File | undefined> {
  return new Promise((resolve, reject) => {
    validIdUpload(req, res, (err: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      const file = req.file;
      if (!file) {
        resolve(undefined);
        return;
      }
      const detected = detectValidIdMime(file.buffer);
      if (!detected || !ALLOWED_MIME.has(detected)) {
        reject(new Error('Valid ID content must be a real JPG, PNG, WEBP, or PDF file.'));
        return;
      }
      // Prefer sniffed type over client-declared MIME.
      file.mimetype = detected;
      // Never trust raw path-like names from the client.
      file.originalname = String(file.originalname || 'valid-id')
        .replace(/[/\\]/g, '_')
        .replace(/[^\w.\- ()[\]]+/g, '_')
        .slice(0, 180);
      resolve(file);
    });
  });
}
