import {
  qrUrlForPaymentMethod,
  resolveHotelPaymentQrs,
  collectPaymentQrCandidates,
  listAvailableWalletMethods,
} from '../utils/paymentQr';

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
        qrph: { qr_url: 'payment-qr/qrph.jpg' },
      }),
    })).toEqual({
      generic: 'payment-qr/old.jpg',
      maya: 'payment-qr/new-maya.jpg',
      qrph: 'payment-qr/qrph.jpg',
    });
  });

  it('reads dedicated QR Ph paths separately from Maya', () => {
    expect(resolveHotelPaymentQrs({
      payment_settings: {
        maya_qr: 'payment-qr/maya.jpg',
        qrph_qr: 'payment-qr/qrph.jpg',
      },
    })).toEqual({
      maya: 'payment-qr/maya.jpg',
      qrph: 'payment-qr/qrph.jpg',
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

describe('listAvailableWalletMethods', () => {
  it('lists only methods with their own uploaded QR', () => {
    expect(listAvailableWalletMethods({
      maya: 'payment-qr/maya.jpg',
      generic: 'payment-qr/old.jpg',
    })).toEqual(['maya']);
  });

  it('offers all wallets when only a generic QR exists', () => {
    expect(listAvailableWalletMethods({
      generic: 'payment-qr/shared.jpg',
    })).toEqual(['gcash', 'maya', 'qrph']);
  });
});

describe('qrUrlForPaymentMethod', () => {
  it('falls back to the generic hotel QR when no dedicated wallets exist', () => {
    const qrs = { generic: 'https://cdn.example.com/pay.png' };
    expect(qrUrlForPaymentMethod(qrs, 'gcash')).toBe('https://cdn.example.com/pay.png');
    expect(qrUrlForPaymentMethod(qrs, 'maya')).toBe('https://cdn.example.com/pay.png');
    expect(qrUrlForPaymentMethod(qrs, 'qrph')).toBe('https://cdn.example.com/pay.png');
  });

  it('prefers a dedicated wallet QR and never lends another wallet the generic', () => {
    const qrs = {
      gcash: 'payment-qr/gcash.jpg',
      maya: 'payment-qr/maya.jpg',
      qrph: 'payment-qr/qrph.jpg',
      generic: 'payment-qr/shared.jpg',
    };
    expect(qrUrlForPaymentMethod(qrs, 'gcash')).toBe('payment-qr/gcash.jpg');
    expect(qrUrlForPaymentMethod(qrs, 'maya')).toBe('payment-qr/maya.jpg');
    expect(qrUrlForPaymentMethod(qrs, 'qrph')).toBe('payment-qr/qrph.jpg');
  });

  it('does not show Maya QR for QR Ph when only Maya was uploaded', () => {
    const qrs = {
      maya: 'payment-qr/maya.jpg',
      generic: 'payment-qr/old.jpg',
    };
    expect(qrUrlForPaymentMethod(qrs, 'maya')).toBe('payment-qr/maya.jpg');
    expect(qrUrlForPaymentMethod(qrs, 'qrph')).toBeUndefined();
  });
});
