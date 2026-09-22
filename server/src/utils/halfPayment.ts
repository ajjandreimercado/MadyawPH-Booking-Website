/**
 * Online payment policy for website bookings.
 *
 * Website reservations always collect full stay payment after hotel confirmation.
 * Helpers still accept half/full for ledger compatibility and older booking docs.
 */

export type OnlinePaymentMode = 'half' | 'full';

export interface OnlinePaymentDue {
  mode: OnlinePaymentMode;
  depositPercent: number;
  /** Amount expected from the guest online (full stay for website bookings). */
  amountDue: number;
  balanceDue: number;
  /** Hotel-app payment_status vocab: unpaid | partial | paid */
  paymentStatus: 'partial' | 'paid';
}

/** Half of a peso amount, rounded to whole pesos for hotel cash ops. */
export function computeHalfPayment(totalAmount: number): { halfPayment: number; balanceDue: number } {
  const due = computeOnlinePaymentDue(totalAmount, 'half');
  return { halfPayment: due.amountDue, balanceDue: due.balanceDue };
}

export function computeOnlinePaymentDue(
  totalAmount: number,
  mode: OnlinePaymentMode = 'full',
): OnlinePaymentDue {
  const total = Math.max(0, Math.round(Number(totalAmount) || 0));
  if (mode === 'full') {
    return {
      mode: 'full',
      depositPercent: 100,
      amountDue: total,
      balanceDue: 0,
      paymentStatus: 'paid',
    };
  }
  const amountDue = Math.floor(total / 2);
  return {
    mode: 'half',
    depositPercent: 50,
    amountDue,
    balanceDue: Math.max(0, total - amountDue),
    paymentStatus: 'partial',
  };
}

export function formatMoneyAmount(value: number): string {
  return Number(value).toFixed(2);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizePaymentMode(raw: unknown): OnlinePaymentMode | null {
  if (typeof raw === 'boolean') return raw ? 'full' : 'half';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw >= 100) return 'full';
    if (raw > 0) return 'half';
    return null;
  }
  if (typeof raw !== 'string') return null;

  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!value) return null;

  if (
    value === 'full'
    || value === 'full_payment'
    || value === 'fullpayment'
    || value === 'pay_full'
    || value === '100'
    || value === '100%'
    || value === 'entire'
    || value === 'complete'
  ) {
    return 'full';
  }

  if (
    value === 'half'
    || value === 'half_payment'
    || value === 'halfpayment'
    || value === 'partial'
    || value === 'partial_payment'
    || value === 'deposit'
    || value === '50'
    || value === '50%'
  ) {
    return 'half';
  }

  return null;
}

function readNested(hotel: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = hotel;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

const MODE_PATHS: string[][] = [
  ['online_payment_mode'],
  ['onlinePaymentMode'],
  ['online_payment_type'],
  ['onlinePaymentType'],
  ['website_payment_mode'],
  ['websitePaymentMode'],
  ['booking_payment_mode'],
  ['bookingPaymentMode'],
  ['payment_mode'],
  ['paymentMode'],
  ['online_booking_payment'],
  ['onlineBookingPayment'],
  ['online_booking_payment_mode'],
  ['onlineBookingPaymentMode'],
  ['settings', 'online_payment_mode'],
  ['settings', 'onlinePaymentMode'],
  ['settings', 'online_payment_type'],
  ['settings', 'website_payment_mode'],
  ['settings', 'booking_payment_mode'],
  ['settings', 'payment_mode'],
  ['payment_settings', 'online_payment_mode'],
  ['payment_settings', 'mode'],
  ['paymentSettings', 'onlinePaymentMode'],
  ['paymentSettings', 'mode'],
];

const FULL_FLAG_PATHS: string[][] = [
  ['require_full_payment'],
  ['requireFullPayment'],
  ['full_payment_required'],
  ['fullPaymentRequired'],
  ['settings', 'require_full_payment'],
  ['settings', 'requireFullPayment'],
];

const DEPOSIT_PERCENT_PATHS: string[][] = [
  ['deposit_percent'],
  ['depositPercent'],
  ['online_deposit_percent'],
  ['onlineDepositPercent'],
  ['online_booking_deposit_percent'],
  ['onlineBookingDepositPercent'],
  ['settings', 'deposit_percent'],
  ['settings', 'depositPercent'],
  ['payment_settings', 'deposit_percent'],
  ['paymentSettings', 'depositPercent'],
];

/**
 * Resolve half vs full from a hotel document (shared Mongo with the hotel app).
 * Website booking create always forces full; this remains for hotel serialize/UI.
 * Default is `full` when the hotel has no recognizable setting.
 */
export function resolveHotelOnlinePaymentMode(hotel: unknown): OnlinePaymentMode {
  const record = asRecord(hotel);
  if (!record) return 'full';

  for (const path of MODE_PATHS) {
    const mode = normalizePaymentMode(readNested(record, path));
    if (mode) return mode;
  }

  for (const path of FULL_FLAG_PATHS) {
    const flag = readNested(record, path);
    if (flag === true || flag === 'true' || flag === 1 || flag === '1') return 'full';
    if (flag === false || flag === 'false' || flag === 0 || flag === '0') return 'half';
  }

  for (const path of DEPOSIT_PERCENT_PATHS) {
    const raw = readNested(record, path);
    const pct = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(pct) || pct <= 0) continue;
    if (pct >= 100) return 'full';
    return 'half';
  }

  return 'full';
}

export function resolveOnlinePaymentModeFromBooking(booking: unknown): OnlinePaymentMode {
  const record = asRecord(booking);
  if (!record) return 'full';

  const direct = normalizePaymentMode(
    record.online_payment_mode
    ?? record.onlinePaymentMode
    ?? record.deposit_percent
    ?? record.depositPercent,
  );
  if (direct) return direct;

  const total = Number(record.totalPrice ?? record.total_amount ?? 0);
  const paid = Number(record.amount_paid ?? record.amountPaid ?? 0);
  if (total > 0 && paid > 0 && paid < total) return 'half';
  return 'full';
}
