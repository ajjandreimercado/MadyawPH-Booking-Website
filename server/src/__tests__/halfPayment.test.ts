import { computeHalfPayment, formatMoneyAmount } from '../utils/halfPayment';

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

describe('formatMoneyAmount', () => {
  it('formats to two decimal places for hotel billing_charges', () => {
    expect(formatMoneyAmount(5000)).toBe('5000.00');
    expect(formatMoneyAmount(-2500.5)).toBe('-2500.50');
  });
});
