import { qrUrlForPaymentMethod, resolveHotelPaymentQrs } from '../utils/paymentQr';

describe('resolveHotelPaymentQrs', () => {
  it('reads a single uploaded QR as generic', () => {
    expect(resolveHotelPaymentQrs({
      payment_qr_url: 'https://cdn.example.com/hotel-qr.png',
    })).toEqual({ generic: 'https://cdn.example.com/hotel-qr.png' });
  });

  it('reads GCash / Maya aliases from nested settings', () => {
    expect(resolveHotelPaymentQrs({
      payment_settings: {
        gcash_qr: 'https://cdn.example.com/gcash.png',
        maya: { url: 'https://cdn.example.com/maya.png' },
      },
    })).toEqual({
      gcash: 'https://cdn.example.com/gcash.png',
      maya: 'https://cdn.example.com/maya.png',
    });
  });

  it('accepts data URLs and relative paths', () => {
    expect(resolveHotelPaymentQrs({
      gcash_qr: 'data:image/png;base64,abc',
      qr_code: '/uploads/qr.png',
    })).toEqual({
      gcash: 'data:image/png;base64,abc',
      generic: '/uploads/qr.png',
    });
  });
});

describe('qrUrlForPaymentMethod', () => {
  it('falls back to the generic hotel QR', () => {
    const qrs = { generic: 'https://cdn.example.com/pay.png' };
    expect(qrUrlForPaymentMethod(qrs, 'gcash')).toBe('https://cdn.example.com/pay.png');
    expect(qrUrlForPaymentMethod(qrs, 'maya')).toBe('https://cdn.example.com/pay.png');
  });
});
