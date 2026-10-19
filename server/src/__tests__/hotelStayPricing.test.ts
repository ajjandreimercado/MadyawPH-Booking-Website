import './testSetup';
import {
  computeStayCharge,
  hourlyConfig,
  nearest50,
  resolveStayWindow,
} from '../utils/hotelStayPricing';

const noSurge = (base: number) => nearest50(base);

describe('hotel app pricing port', () => {
  it('rounds pesos to the nearest ₱50 like PriceRounding::nearest50', () => {
    expect(nearest50(520)).toBe(500);
    expect(nearest50(530)).toBe(550);
    expect(nearest50(525)).toBe(550);
    expect(nearest50(0)).toBe(0);
  });

  it('prices nightly stays as rounded rate × nights, check-out 11:00', () => {
    const room = { price_per_night: 1180 };
    const window = resolveStayWindow(room, null, '2026-10-20', '2026-10-22');
    expect(window.checkOutTime).toBe('11:00');
    const charge = computeStayCharge(room, null, window, noSurge);
    expect(charge).toMatchObject({ billingMode: 'nightly', nights: 2, unitPrice: 1200, amount: 2400 });
  });

  it('prices a same-day hourly stay as one block from the arrival time', () => {
    const room = { billing_mode: 'hourly', price_per_block: 1000 };
    const category = { block_hours: 12 };
    const window = resolveStayWindow(room, category, '2026-10-20', '2026-10-20', '15:00');
    expect(window).toMatchObject({ checkInTime: '15:00', checkOutDate: '2026-10-21', checkOutTime: '03:00' });
    const charge = computeStayCharge(room, category, window, noSurge);
    expect(charge).toMatchObject({ billingMode: 'hourly', stayHours: 12, blockHours: 12, blocks: 1, amount: 1000 });
  });

  it('prices a multi-day hourly stay in blocks until 11:00 on the check-out day', () => {
    const room = { billing_mode: 'hourly', price_per_block: 500 };
    const window = resolveStayWindow(room, { block_hours: 6 }, '2026-10-20', '2026-10-21', '14:00');
    const charge = computeStayCharge(room, { block_hours: 6 }, window, noSurge);
    // 14:00 → 11:00 next day = 21 h → 4 blocks of 6 h.
    expect(charge).toMatchObject({ stayHours: 21, blocks: 4, amount: 2000 });
  });

  it('takes the block length from the category, then the room, then 3 h', () => {
    expect(hourlyConfig({ block_hours: 4, price_per_block: 300 }, { block_hours: 8 }).blockHours).toBe(8);
    expect(hourlyConfig({ block_hours: 4, price_per_block: 300 }, null).blockHours).toBe(4);
    expect(hourlyConfig({ price_per_night: 900 }, null)).toEqual({ blockHours: 3, pricePerBlock: 900 });
  });

  it('applies surge to the unit price before multiplying', () => {
    const surge = (base: number) => nearest50(nearest50(base) * 1.2);
    const room = { price_per_night: 1000 };
    const charge = computeStayCharge(room, null, resolveStayWindow(room, null, '2026-10-20', '2026-10-21'), surge);
    expect(charge.amount).toBe(1200);
  });
});
