import { resolvePromoPricing } from '../utils/promoPricing';

describe('resolvePromoPricing', () => {
  it('uses an explicit promo price below the regular price', () => {
    expect(resolvePromoPricing({ promo_price: 900 }, 1400))
      .toEqual({ hasPromo: true, promoPrice: 900, regularPrice: 1400 });
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
