import './testSetup';
import { hotelPaymentMeta } from '../utils/externalReservation';

describe('hotelPaymentMeta (MADYAWPH online-booking payment fields)', () => {
  it('marks a full receipt as paid, pending the hotel approval', () => {
    expect(hotelPaymentMeta({ total: 2400, amountPaid: 2400 })).toMatchObject({
      payment_method: 'Online',
      payment_status: 'paid_pending_approval',
      total_amount: 2400,
      amount_paid: 2400,
      deposit_required: 2400,
      balance_due: 0,
    });
  });

  it('marks a short receipt as a deposit and keeps the balance', () => {
    expect(hotelPaymentMeta({ total: 2400, amountPaid: 1000 })).toMatchObject({
      payment_status: 'deposit_pending_approval',
      balance_due: 1400,
    });
  });

  it('becomes paid once the hotel approves', () => {
    expect(hotelPaymentMeta({ total: 2400, amountPaid: 2400, approved: true }).payment_status).toBe('paid');
    expect(hotelPaymentMeta({ total: 2400, amountPaid: 1000, approved: true }).payment_status).toBe('deposit_paid');
    expect(hotelPaymentMeta({ total: 2400, amountPaid: 0 }).payment_status).toBe('unpaid');
  });
});
