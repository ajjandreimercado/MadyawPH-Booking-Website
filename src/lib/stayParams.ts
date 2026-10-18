import { addDays, format, isValid, parseISO } from 'date-fns';

/** A guest's stay, kept in the URL (?checkIn&checkOut&adults&children) so pages can be refreshed or shared. */
export interface Stay {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function defaultStay(): Stay {
  return {
    checkIn: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    checkOut: format(addDays(new Date(), 2), 'yyyy-MM-dd'),
    adults: 2,
    children: 0,
  };
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Read the stay from URL params; invalid or missing values fall back to tomorrow, 1 night, 2 adults. */
export function readStay(params: URLSearchParams): Stay {
  const fallback = defaultStay();
  const checkIn = params.get('checkIn') ?? '';
  const checkOut = params.get('checkOut') ?? '';
  const datesValid = DATE_RE.test(checkIn) && DATE_RE.test(checkOut) && checkOut > checkIn;
  // Older links only carry ?guests=N (adults + children).
  const adults = clampInt(params.get('adults') ?? params.get('guests'), 1, 6, fallback.adults);
  return {
    checkIn: datesValid ? checkIn : fallback.checkIn,
    checkOut: datesValid ? checkOut : fallback.checkOut,
    adults,
    children: clampInt(params.get('children'), 0, 4, 0),
  };
}

/** Copy the stay into URL params, keeping any other params (destination, filters…). */
export function writeStay(params: URLSearchParams, stay: Stay): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('checkIn', stay.checkIn);
  next.set('checkOut', stay.checkOut);
  next.set('adults', String(stay.adults));
  next.set('children', String(stay.children));
  next.set('guests', String(stay.adults + stay.children));
  return next;
}

/** Query string with only the stay, for links between steps. */
export function stayQuery(stay: Stay): string {
  return writeStay(new URLSearchParams(), stay).toString();
}

export function stayNights(stay: Pick<Stay, 'checkIn' | 'checkOut'>): number {
  const ms = parseISO(stay.checkOut).getTime() - parseISO(stay.checkIn).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** yyyy-MM-dd → "Oct 18, 2026" (month-day-year); unparseable input is returned as-is. */
export function formatStayDate(value: string): string {
  const date = parseISO(value);
  return isValid(date) ? format(date, 'MMM d, yyyy') : value;
}

export function describeGuests(stay: Pick<Stay, 'adults' | 'children'>): string {
  const adults = `${stay.adults} adult${stay.adults === 1 ? '' : 's'}`;
  return stay.children > 0 ? `${adults}, ${stay.children} child${stay.children === 1 ? '' : 'ren'}` : adults;
}

export function peso(amount: number): string {
  return `₱${Math.max(0, Math.round(amount)).toLocaleString('en-PH')}`;
}
