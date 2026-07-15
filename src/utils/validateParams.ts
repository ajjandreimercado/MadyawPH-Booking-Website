import { sanitize } from './sanitize';

export interface ValidatedFilters {
  priceRange: [number, number];
  maxPrice: number;
  rating: 0 | 3 | 4 | 5;
  types: string[];
  amenities: string[];
  dest: string;
}

const DEFAULT_MAX_PRICE = 50000;
const MAX_ALLOWED_PRICE = 500000;
const MAX_DEST_LENGTH = 100;
const VALID_RATINGS = [0, 3, 4, 5] as const;

export interface ValidateParamsOptions {
  propertyTypes?: string[];
  amenities?: string[];
}

function warnRejected(key: string, value: string | null) {
  if (import.meta.env.DEV) {
    console.warn('Madyaw: rejected invalid param —', key, value);
  }
}

function parseMaxPrice(params: URLSearchParams): number {
  const rawValue = params.get('maxPrice') ?? params.get('priceMax');

  if (rawValue === null) {
    return DEFAULT_MAX_PRICE;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_ALLOWED_PRICE) {
    warnRejected('maxPrice', rawValue);
    return DEFAULT_MAX_PRICE;
  }

  return parsed;
}

function parseRating(params: URLSearchParams): 0 | 3 | 4 | 5 {
  const rawValue = params.get('rating');

  if (rawValue === null) {
    return 0;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!VALID_RATINGS.includes(parsed as 0 | 3 | 4 | 5)) {
    warnRejected('rating', rawValue);
    return 0;
  }

  return parsed as 0 | 3 | 4 | 5;
}

function parseSubset(params: URLSearchParams, key: 'types' | 'amenities', allowedValues: string[]): string[] {
  const rawValue = params.get(key);

  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (allowedValues.includes(item)) {
        return true;
      }

      warnRejected(key, item);
      return false;
    });
}

export function validateParams(params: URLSearchParams, options: ValidateParamsOptions = {}): ValidatedFilters {
  const maxPrice = parseMaxPrice(params);
  const sanitizedDestination = sanitize(params.get('dest') ?? params.get('destination') ?? '');
  const destination = sanitizedDestination.slice(0, MAX_DEST_LENGTH);
  const propertyTypes = options.propertyTypes ?? [];
  const amenityOptions = options.amenities ?? [];

  if (sanitizedDestination.length > MAX_DEST_LENGTH) {
    warnRejected('dest', sanitizedDestination);
  }

  return {
    priceRange: [0, maxPrice],
    maxPrice,
    rating: parseRating(params),
    types: parseSubset(params, 'types', propertyTypes),
    amenities: parseSubset(params, 'amenities', amenityOptions),
    dest: destination,
  };
}
