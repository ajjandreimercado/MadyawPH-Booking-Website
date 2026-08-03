import { detectValidIdMime } from '../middleware/validIdUpload';

describe('detectValidIdMime', () => {
  it('detects JPEG magic bytes', () => {
    expect(detectValidIdMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('detects PNG magic bytes', () => {
    expect(detectValidIdMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('detects PDF magic bytes', () => {
    expect(detectValidIdMime(Buffer.from('%PDF-1.4'))).toBe('application/pdf');
  });

  it('rejects unknown content', () => {
    expect(detectValidIdMime(Buffer.from('not-a-real-file'))).toBeNull();
  });
});
