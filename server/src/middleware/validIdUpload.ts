import multer from 'multer';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const VALID_ID_MAX_BYTES = 5 * 1024 * 1024;

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
      resolve(req.file);
    });
  });
}
