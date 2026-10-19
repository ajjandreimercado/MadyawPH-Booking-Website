import { addDays, format, isValid, parseISO } from 'date-fns';

/** A guest's stay, kept in the URL (?checkIn&checkOut&adults&children) so pages can be refreshed or shared. */
export interface Stay {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  /** Hourly room types: one block on the check-in day (checkOut === checkIn), ?block=1. */
  block?: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAY_STORAGE_KEY = 'madyaw.stay';

export function defaultStay(): Stay {
  const today = format(new Date(), 'yyyy-MM-dd');
  return {
    checkIn: today,
    checkOut: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    adults: 1,
    children: 0,
  };
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function normalizeStay(raw: Partial<Stay> | null | undefined, fallback: Stay): Stay | null {
  if (!raw) return null;
  const checkIn = String(raw.checkIn ?? '');
  const checkOut = String(raw.checkOut ?? '');
  const block = raw.block === true && DATE_RE.test(checkIn) && checkOut === checkIn;
  const datesValid = DATE_RE.test(checkIn) && DATE_RE.test(checkOut) && (checkOut > checkIn || block);
  if (!datesValid) return null;
  return {
    checkIn,
    checkOut,
    adults: clampInt(String(raw.adults ?? ''), 1, 6, fallback.adults),
    children: clampInt(String(raw.children ?? ''), 0, 4, fallback.children),
    ...(block ? { block: true } : {}),
  };
}

/** Persist the guest's dates/party so homepage → hotel (and back) keep the same stay. */
export function rememberStay(stay: Stay): void {
  try {
    sessionStorage.setItem(STAY_STORAGE_KEY, JSON.stringify({
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: stay.adults,
      children: stay.children,
      ...(stay.block ? { block: true } : {}),
    }));
  } catch {
    // Private mode / blocked storage — URL params still work.
  }
}

/** Last stay the guest set this session, or null if none / invalid. */
export function recalledStay(): Stay | null {
  try {
    const raw = sessionStorage.getItem(STAY_STORAGE_KEY);
    if (!raw) return null;
    return normalizeStay(JSON.parse(raw) as Partial<Stay>, defaultStay());
  } catch {
    return null;
  }
}

/** Stay for links when the URL has none yet (homepage cards, etc.). */
export function currentStay(): Stay {
  return recalledStay() ?? defaultStay();
}

/** Read the stay from URL params; missing values fall back to the session stay, then today / 1 adult. */
export function readStay(params: URLSearchParams): Stay {
  const fallback = currentStay();
  const checkIn = params.get('checkIn') ?? '';
  const checkOut = params.get('checkOut') ?? '';
  const block = params.get('block') === '1' && DATE_RE.test(checkIn) && checkOut === checkIn;
  const datesValid = DATE_RE.test(checkIn) && DATE_RE.test(checkOut) && (checkOut > checkIn || block);
  // Older links only carry ?guests=N (adults + children).
  const adults = clampInt(params.get('adults') ?? params.get('guests'), 1, 6, fallback.adults);
  const stay: Stay = {
    checkIn: datesValid ? checkIn : fallback.checkIn,
    checkOut: datesValid ? checkOut : fallback.checkOut,
    adults: params.has('adults') || params.has('guests') ? adults : fallback.adults,
    children: params.has('children')
      ? clampInt(params.get('children'), 0, 4, 0)
      : fallback.children,
    ...(block && datesValid ? { block: true } : {}),
  };
  return stay;
}

/** Copy the stay into URL params, keeping any other params (destination, filters…). */
export function writeStay(params: URLSearchParams, stay: Stay): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('checkIn', stay.checkIn);
  next.set('checkOut', stay.checkOut);
  next.set('adults', String(stay.adults));
  next.set('children', String(stay.children));
  next.set('guests', String(stay.adults + stay.children));
  if (stay.block) next.set('block', '1');
  else next.delete('block');
  rememberStay(stay);
  return next;
}

/** Query string with only the stay, for links between steps. */
export function stayQuery(stay: Stay = currentStay()): string {
  return writeStay(new URLSearchParams(), stay).toString();
}

/** Append the current (or given) stay to a path — used by homepage hotel cards. */
export function withStay(path: string, stay: Stay = currentStay()): string {
  const q = stayQuery(stay);
  if (!q) return path;
  return path.includes('?') ? `${path}&${q}` : `${path}?${q}`;
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
