import { qrUrlForPaymentMethod, resolveHotelPaymentQrs, collectPaymentQrCandidates } from '../utils/paymentQr';

describe('resolveHotelPaymentQrs', () => {
  it('reads a single uploaded QR as generic', () => {
    expect(resolveHotelPaymentQrs({
      payment_qr_url: 'payment-qr/hotel-gcash.jpg',
    })).toEqual({ generic: 'payment-qr/hotel-gcash.jpg' });
  });

  it('reads payment_method_qrs JSON from system settings', () => {
    expect(resolveHotelPaymentQrs({
      payment_qr_url: 'payment-qr/old.jpg',
      payment_method_qrs: JSON.stringify({
        paymaya: { qr_url: 'payment-qr/new-maya.jpg', account_number: '09' },
      }),
    })).toEqual({
      generic: 'payment-qr/old.jpg',
      maya: 'payment-qr/new-maya.jpg',
    });
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

describe('collectPaymentQrCandidates', () => {
  it('prefers method-specific QR paths before generic', () => {
    const settings = {
      payment_qr_url: 'payment-qr/old.jpg',
      payment_method_qrs: JSON.stringify({
        paymaya: { qr_url: 'payment-qr/new-maya.jpg' },
      }),
    };
    expect(collectPaymentQrCandidates({}, settings)).toEqual([
      'payment-qr/new-maya.jpg',
      'payment-qr/old.jpg',
    ]);
  });
});

describe('qrUrlForPaymentMethod', () => {
  it('falls back to the generic hotel QR', () => {
    const qrs = { generic: 'https://cdn.example.com/pay.png' };
    expect(qrUrlForPaymentMethod(qrs, 'gcash')).toBe('https://cdn.example.com/pay.png');
    expect(qrUrlForPaymentMethod(qrs, 'maya')).toBe('https://cdn.example.com/pay.png');
  });
});
