import { Link } from 'react-router-dom';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import type { StayQuote } from '../../services/api';
import { NO_PHOTO_SRC, showNoPhoto } from '../../lib/hotelImage';
import { describeGuests, formatStayDate, peso, type Stay } from '../../lib/stayParams';

const DISCOUNT_LABELS: Record<string, string> = {
  pwd: 'PWD discount (20%)',
  'senior citizen': 'Senior citizen discount (20%)',
  member: 'Madyaw member discount',
  promo: 'Promo code discount',
};

/** "15:00" → "3:00 PM". */
export function clockLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "12 hours (1 × 12 h)" for hourly stays, "2 nights" for nightly — from the server quote. */
export function stayLengthLabel(quote: StayQuote | null): string | null {
  if (!quote) return null;
  if (quote.billingMode === 'hourly' && quote.stayHours) {
    return `${quote.stayHours} hour${quote.stayHours === 1 ? '' : 's'}${quote.blocks && quote.blockHours ? ` (${quote.blocks} × ${quote.blockHours} h)` : ''}`;
  }
  return `${quote.nights} night${quote.nights === 1 ? '' : 's'}`;
}

/** Progress tracker at the top of checkout: (1) Your details → (2) Finish booking. */
export function CheckoutProgress({ step }: { step: 1 | 2 }) {
  const item = (n: 1 | 2, label: string) => (
    <li className={`flex items-center gap-2 ${step >= n ? 'text-brand-primary' : 'text-brand-dark/40'}`} aria-current={step === n ? 'step' : undefined}>
      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
        step > n ? 'bg-brand-primary text-white' : step === n ? 'border-2 border-brand-primary' : 'border-2 border-brand-dark/20'
      }`}>
        {step > n ? <Check className="w-4 h-4" aria-hidden /> : n}
      </span>
      <span className="text-sm font-bold">{label}</span>
    </li>
  );
  return (
    <ol className="flex items-center gap-3 mb-6" aria-label="Checkout progress">
      {item(1, 'Your details')}
      <li aria-hidden className={`h-0.5 flex-1 max-w-24 ${step > 1 ? 'bg-brand-primary' : 'bg-brand-dark/15'}`} />
      {item(2, 'Finish booking')}
    </ol>
  );
}

interface SummaryProps {
  roomName: string;
  roomImage?: string;
  hotelName?: string;
  location?: string;
  stay: Stay;
  /** Back to Rooms Available with the same stay, to change room, dates or guests. */
  changeSelectionHref: string;
  quote: StayQuote | null;
  quoteLoading: boolean;
  quoteError: string | null;
  freeCancellation?: boolean;
  /** Cancellation policy ("Non-refundable") is shown only on the final details step. */
  showCancellation?: boolean;
}

function PriceLines({ quote, quoteLoading, quoteError }: Pick<SummaryProps, 'quote' | 'quoteLoading' | 'quoteError'>) {
  if (quoteError) return <p className="text-sm font-bold text-brand-danger">{quoteError}</p>;
  if (!quote) {
    return <p className="flex items-center gap-2 text-sm font-bold text-brand-dark/60"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Getting your price…</p>;
  }
  const nights = `${quote.nights} night${quote.nights === 1 ? '' : 's'}`;
  return (
    <div className={`space-y-2 text-sm font-bold ${quoteLoading ? 'opacity-60' : ''}`} aria-busy={quoteLoading}>
      <div className="flex justify-between gap-3">
        <span className="text-brand-dark/65">Room, {nights}</span>
        <span className="text-brand-dark tabular-nums">{peso(quote.stayPrice)}</span>
      </div>
      {quote.discountAmount > 0 && (
        <div className="flex justify-between gap-3 text-brand-success">
          <span>{DISCOUNT_LABELS[quote.discountType] ?? 'Discount'}</span>
          <span className="tabular-nums">−{peso(quote.discountAmount)}</span>
        </div>
      )}
      <details className="group">
        <summary className="flex cursor-pointer list-none justify-between gap-3 text-brand-dark/65">
          <span className="flex items-center gap-1">Taxes and charges <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden /></span>
          <span>Included</span>
        </summary>
        <p className="mt-1 text-[11px] text-brand-dark/50">The hotel's rates already include all taxes and charges. There are no booking fees.</p>
      </details>
      <div className="flex justify-between gap-3 border-t border-brand-primary/10 pt-3 text-lg">
        <span className="text-brand-dark">Total</span>
        <span className="text-brand-dark tabular-nums">{peso(quote.totalPrice)}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-brand-dark/60">{quote.groupBooking ? 'Group booking · 50% down payment now' : 'Pay now by GCash or Maya QR'}</span>
        <span className="text-brand-dark tabular-nums">{peso(quote.dueNow)}</span>
      </div>
      {quote.dueAfterConfirmation > 0 && (
        <div className="flex justify-between gap-3 text-xs">
          <span className="text-brand-dark/60">Balance at the hotel</span>
          <span className="text-brand-dark tabular-nums">{peso(quote.dueAfterConfirmation)}</span>
        </div>
      )}
      {!quote.available && (
        <p className="text-xs font-bold text-brand-danger">This room was just booked for these dates. Change your selection to continue.</p>
      )}
    </div>
  );
}

function SummaryBody(props: SummaryProps) {
  const { stay, quote } = props;
  const nights = quote?.nights;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-brand-primary/15 bg-white p-4 space-y-3">
        <h2 className="font-bold text-brand-dark">Your booking details</h2>
        <div className="flex gap-3">
          <img src={props.roomImage || NO_PHOTO_SRC} alt="" onError={showNoPhoto} className="w-16 h-14 rounded-lg object-cover shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-brand-dark">{props.roomName}</p>
            {props.hotelName && <p className="text-xs font-bold text-brand-dark/60">{props.hotelName}</p>}
            {props.location && <p className="text-[11px] text-brand-dark/50 line-clamp-2">{props.location}</p>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-[11px] font-bold text-brand-dark/50">Check-in</dt><dd className="font-bold text-brand-dark">{formatStayDate(stay.checkIn)}</dd><dd className="text-[11px] text-brand-dark/50">From {clockLabel(quote?.checkInTime ?? '14:00')}</dd></div>
          <div><dt className="text-[11px] font-bold text-brand-dark/50">Check-out</dt><dd className="font-bold text-brand-dark">{formatStayDate(quote?.checkOutDate ?? stay.checkOut)}</dd><dd className="text-[11px] text-brand-dark/50">Until {clockLabel(quote?.checkOutTime ?? '11:00')}</dd></div>
        </dl>
        <p className="text-sm font-bold text-brand-dark">
          {stayLengthLabel(quote) ?? (nights ? `${nights} night${nights === 1 ? '' : 's'}` : '')}
          {' · '}{describeGuests(stay)} · 1 room
        </p>
        <Link to={props.changeSelectionHref} className="inline-block text-sm font-bold text-brand-primary underline underline-offset-2">
          Change your selection
        </Link>
      </section>

      <section className="rounded-xl border border-brand-primary/15 bg-white p-4">
        <h2 className="font-bold text-brand-dark mb-3">Your price summary</h2>
        <PriceLines quote={props.quote} quoteLoading={props.quoteLoading} quoteError={props.quoteError} />
      </section>

      {props.showCancellation && (
        <section className="rounded-xl border border-brand-primary/15 bg-white p-4 text-sm">
          <h2 className="font-bold text-brand-dark mb-2">Cancellation policy</h2>
          <p className="font-bold text-brand-danger">Non-refundable</p>
          <p className="text-brand-dark/70">
            All bookings are non-refundable. Once you pay, your payment can't be refunded if you cancel, change
            your dates or don't arrive. If the hotel declines your booking, you get a full refund.
          </p>
          <Link to="/cancellation" className="mt-1 inline-block text-xs font-bold text-brand-primary underline underline-offset-2">Read the full policy</Link>
        </section>
      )}

      <ul className="space-y-1.5 text-sm font-bold text-brand-dark/75">
        {['Pay by scanning the hotel’s own GCash or Maya QR', 'Upload your receipt screenshot', 'The hotel verifies it and confirms by email'].map((line) => (
          <li key={line} className="flex items-start gap-2"><Check className="w-4 h-4 mt-0.5 shrink-0 text-brand-success" aria-hidden />{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** Sticky sidebar on desktop; a collapsible summary (total visible) at the top on phones. */
export default function CheckoutSummary(props: SummaryProps) {
  return (
    <>
      <details className="lg:hidden rounded-xl border border-brand-primary/15 bg-white mb-4 group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <span className="text-sm font-bold text-brand-dark">Booking summary</span>
          <span className="flex items-center gap-2 text-base font-bold text-brand-dark tabular-nums">
            {props.quote ? peso(props.quote.totalPrice) : '…'}
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden />
          </span>
        </summary>
        <div className="px-4 pb-4"><SummaryBody {...props} /></div>
      </details>
      <aside className="hidden lg:block lg:sticky lg:top-[96px]">
        <SummaryBody {...props} />
      </aside>
    </>
  );
}
