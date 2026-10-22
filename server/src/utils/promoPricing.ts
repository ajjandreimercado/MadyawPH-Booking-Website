/**
 * Promo pricing set in the hotel app (MADYAWPH).
 *
 * The hotel app has used several field names for "promo price" over versions, so —
 * like halfPayment.ts — this resolver reads every known alias on rooms, room
 * categories, hotels, and system settings (including nested `settings` objects).
 *
 * Rules:
 *  - An explicit promo price lower than the regular price wins.
 *  - A promo percent (e.g. 20) applies to the regular price.
 *  - A promo on/off flag with no separate promo price means the listed price
 *    already IS the promo price (regular price shown only when a separate
 *    original/regular price is stored).
 */

export interface PromoPricing {
  hasPromo: boolean;
  /** Effective promo price per night/block, when promo is on. */
  promoPrice: number;
  /** Regular (non-promo) price, for strikethrough display. */
  regularPrice: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNested(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    const nested = asRecord(current);
    if (!nested) return undefined;
    current = nested[key];
  }
  return current;
}

const SETTINGS_WRAPPERS = ['', 'settings', 'system_settings', 'systemSettings', 'pricing', 'promo'] as const;

function pathsFor(names: string[]): string[][] {
  const paths: string[][] = [];
  for (const wrapper of SETTINGS_WRAPPERS) {
    for (const name of names) {
      paths.push(wrapper ? [wrapper, name] : [name]);
    }
  }
  return paths;
}

const PROMO_PRICE_PATHS = pathsFor([
  'promo_price', 'promoPrice',
  // Hotel app (MADYAWPH RoomBillingSupport::listedRates) dual-rate fields.
  'promo_price_per_night', 'promoPricePerNight',
  'promo_price_per_block', 'promoPricePerBlock',
  'promotional_price', 'promotionalPrice',
  'promo_rate', 'promoRate',
  'sale_price', 'salePrice',
  'discounted_price', 'discountedPrice',
  'special_price', 'specialPrice',
]);

const REGULAR_PRICE_PATHS = pathsFor([
  'regular_price', 'regularPrice',
  // Hotel app rack rate shown beside the promo rate.
  'regular_price_per_night', 'regularPricePerNight',
  'regular_price_per_block', 'regularPricePerBlock',
  'original_price', 'originalPrice',
  'normal_price', 'normalPrice',
  'price_before_promo', 'priceBeforePromo',
]);

const PROMO_PERCENT_PATHS = pathsFor([
  'promo_percent', 'promoPercent',
  'promo_discount_percent', 'promoDiscountPercent',
  'promo_discount', 'promoDiscount',
]);

const PROMO_FLAG_PATHS = pathsFor([
  'promo_enabled', 'promoEnabled',
  'is_promo', 'isPromo',
  'on_promo', 'onPromo',
  'has_promo', 'hasPromo',
  'promo_active', 'promoActive',
  'is_on_promo', 'isOnPromo',
  'promo', 'on_sale', 'onSale',
]);

function firstNumber(record: Record<string, unknown>, paths: string[][]): number | null {
  for (const path of paths) {
    const raw = readNested(record, path);
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function promoFlagOn(record: Record<string, unknown>): boolean {
  for (const path of PROMO_FLAG_PATHS) {
    const raw = readNested(record, path);
    if (raw === true || raw === 1 || raw === '1') return true;
    if (typeof raw === 'string') {
      const value = raw.trim().toLowerCase();
      if (value === 'true' || value === 'yes' || value === 'on' || value === 'active') return true;
    }
  }
  return false;
}

/**
 * Resolve promo pricing from one or more records (room, category, hotel, settings —
 * first explicit promo price found wins) against the known regular price.
 */
export function resolvePromoPricing(
  sources: unknown,
  regularPriceInput: number,
): PromoPricing {
  const regularPrice = Math.max(0, Math.round(Number(regularPriceInput) || 0));
  const none: PromoPricing = { hasPromo: false, promoPrice: regularPrice, regularPrice };
  if (!(regularPrice > 0)) return none;

  const records = (Array.isArray(sources) ? sources : [sources])
    .map(asRecord)
    .filter((r): r is Record<string, unknown> => Boolean(r));
  if (records.length === 0) return none;

  let explicitPromo: number | null = null;
  let storedRegular: number | null = null;
  let percent: number | null = null;
  let flagOn = false;

  for (const record of records) {
    explicitPromo ??= firstNumber(record, PROMO_PRICE_PATHS);
    storedRegular ??= firstNumber(record, REGULAR_PRICE_PATHS);
    percent ??= firstNumber(record, PROMO_PERCENT_PATHS);
    if (!flagOn) flagOn = promoFlagOn(record);
  }

  const baseRegular = storedRegular && storedRegular > 0 ? storedRegular : regularPrice;

  if (explicitPromo != null && explicitPromo < baseRegular) {
    return { hasPromo: true, promoPrice: Math.round(explicitPromo), regularPrice: baseRegular };
  }
  if (percent != null && percent > 0 && percent < 100) {
    const promoPrice = Math.round(baseRegular * (1 - percent / 100));
    if (promoPrice > 0 && promoPrice < baseRegular) {
      return { hasPromo: true, promoPrice, regularPrice: baseRegular };
    }
  }
  if (flagOn) {
    // Listed price already is the promo price.
    return { hasPromo: true, promoPrice: regularPrice, regularPrice: baseRegular };
  }
  return none;
}
