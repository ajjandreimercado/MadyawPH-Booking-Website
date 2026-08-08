import {
  computeHalfPayment,
  computeOnlinePaymentDue,
  formatMoneyAmount,
  resolveHotelOnlinePaymentMode,
  resolveOnlinePaymentModeFromBooking,
} from '../utils/halfPayment';

describe('computeHalfPayment', () => {
  it('splits an even total 50/50', () => {
    expect(computeHalfPayment(10000)).toEqual({ halfPayment: 5000, balanceDue: 5000 });
  });

  it('floors the half payment on odd totals so amounts stay whole pesos', () => {
    expect(computeHalfPayment(10001)).toEqual({ halfPayment: 5000, balanceDue: 5001 });
  });

  it('handles zero and negative safely', () => {
    expect(computeHalfPayment(0)).toEqual({ halfPayment: 0, balanceDue: 0 });
    expect(computeHalfPayment(-50)).toEqual({ halfPayment: 0, balanceDue: 0 });
  });
});

describe('computeOnlinePaymentDue', () => {
  it('computes full payment with zero balance', () => {
    expect(computeOnlinePaymentDue(10000, 'full')).toEqual({
      mode: 'full',
      depositPercent: 100,
      amountDue: 10000,
      balanceDue: 0,
      paymentStatus: 'paid',
    });
  });

  it('computes half payment as partial', () => {
    expect(computeOnlinePaymentDue(10001, 'half')).toEqual({
      mode: 'half',
      depositPercent: 50,
      amountDue: 5000,
      balanceDue: 5001,
      paymentStatus: 'partial',
    });
  });
});

describe('resolveHotelOnlinePaymentMode', () => {
  it('defaults to half when hotel has no setting', () => {
    expect(resolveHotelOnlinePaymentMode(null)).toBe('half');
    expect(resolveHotelOnlinePaymentMode({})).toBe('half');
  });

  it('reads common half/full aliases', () => {
    expect(resolveHotelOnlinePaymentMode({ online_payment_mode: 'full' })).toBe('full');
    expect(resolveHotelOnlinePaymentMode({ onlinePaymentMode: 'half' })).toBe('half');
    expect(resolveHotelOnlinePaymentMode({ website_payment_mode: 'full_payment' })).toBe('full');
    expect(resolveHotelOnlinePaymentMode({ require_full_payment: true })).toBe('full');
    expect(resolveHotelOnlinePaymentMode({ deposit_percent: 100 })).toBe('full');
    expect(resolveHotelOnlinePaymentMode({ deposit_percent: 50 })).toBe('half');
    expect(resolveHotelOnlinePaymentMode({ settings: { online_payment_mode: 'full' } })).toBe('full');
  });
});

describe('resolveOnlinePaymentModeFromBooking', () => {
  it('uses snapshot field or inferred full payment', () => {
    expect(resolveOnlinePaymentModeFromBooking({ online_payment_mode: 'full' })).toBe('full');
    expect(resolveOnlinePaymentModeFromBooking({
      totalPrice: 10000,
      amount_paid: 10000,
    })).toBe('full');
    expect(resolveOnlinePaymentModeFromBooking({
      totalPrice: 10000,
      amount_paid: 5000,
    })).toBe('half');
  });
});

describe('formatMoneyAmount', () => {
  it('formats to two decimal places for hotel billing_charges', () => {
    expect(formatMoneyAmount(5000)).toBe('5000.00');
    expect(formatMoneyAmount(-2500.5)).toBe('-2500.50');
  });
});
