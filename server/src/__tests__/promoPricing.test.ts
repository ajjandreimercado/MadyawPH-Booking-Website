import { resolvePromoPricing } from '../utils/promoPricing';

describe('resolvePromoPricing', () => {
  it('uses an explicit promo price below the regular price', () => {
    expect(resolvePromoPricing({ promo_price: 900 }, 1400))
      .toEqual({ hasPromo: true, promoPrice: 900, regularPrice: 1400 });
  });

  it('reads the hotel app dual-rate fields (promo is the listed selling price)', () => {
    // MADYAWPH stores promo_price_per_night as the selling rate (= price_per_night)
    // and regular_price_per_night as the rack rate shown crossed out.
    expect(resolvePromoPricing({ promo_price_per_night: 800, regular_price_per_night: 2000 }, 800))
      .toEqual({ hasPromo: true, promoPrice: 800, regularPrice: 2000 });
    expect(resolvePromoPricing({ promo_price_per_block: 500, regular_price_per_block: 1000 }, 500))
      .toEqual({ hasPromo: true, promoPrice: 500, regularPrice: 1000 });
    // No promo set in the hotel app: both rates are the same, so nothing to cross out.
    expect(resolvePromoPricing({ promo_price_per_night: 800, regular_price_per_night: 800 }, 800).hasPromo)
      .toBe(false);
  });

  it('applies a promo percent', () => {
    expect(resolvePromoPricing({ promo_percent: 20 }, 1000))
      .toEqual({ hasPromo: true, promoPrice: 800, regularPrice: 1000 });
  });

  it('treats the listed price as the promo price when only the flag is on', () => {
    expect(resolvePromoPricing({ promo_enabled: true, regular_price: 1500 }, 1200))
      .toEqual({ hasPromo: true, promoPrice: 1200, regularPrice: 1500 });
  });

  it('reads aliases nested in settings and from later sources', () => {
    expect(resolvePromoPricing([{}, { settings: { salePrice: 700 } }], 1000))
      .toEqual({ hasPromo: true, promoPrice: 700, regularPrice: 1000 });
  });

  it('returns no promo when nothing is set or the promo is not cheaper', () => {
    expect(resolvePromoPricing({}, 1000).hasPromo).toBe(false);
    expect(resolvePromoPricing({ promo_price: 1200 }, 1000).hasPromo).toBe(false);
    expect(resolvePromoPricing({ promo_price: 500 }, 0).hasPromo).toBe(false);
  });
});
