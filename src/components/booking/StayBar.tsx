import { useEffect, useState, type FormEvent } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { Calendar, Pencil, Search, Users } from 'lucide-react';
import { describeGuests, formatStayDate, type Stay } from '../../lib/stayParams';

/**
 * Sticky availability bar (Booking.com step 1): dates and guests stay editable on every
 * results / hotel page, and only apply when the guest presses Search.
 */
export default function StayBar({
  stay,
  onSearch,
  embedded = false,
}: {
  stay: Stay;
  onSearch: (stay: Stay) => void;
  /** Inside an existing sticky header (search page) instead of its own sticky card. */
  embedded?: boolean;
}) {
  const [draft, setDraft] = useState(stay);
  // Phones show a one-line summary until the guest taps Edit, so the bar doesn't eat the screen.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setDraft(stay), [stay.checkIn, stay.checkOut, stay.adults, stay.children]);

  const today = format(new Date(), 'yyyy-MM-dd');
  const minCheckOut = format(addDays(parseISO(draft.checkIn), 1), 'yyyy-MM-dd');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setExpanded(false);
    onSearch(draft);
  };

  const field = 'flex items-center gap-2 rounded-xl border border-brand-primary/20 bg-white px-3 py-2 min-w-0';
  const label = 'block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50';
  const input = 'w-full bg-transparent text-sm font-bold text-brand-dark outline-none';

  return (
    <form
      onSubmit={submit}
      aria-label="Change dates and guests"
      className={embedded
        ? 'w-full'
        : 'sticky top-[4.5rem] sm:top-20 z-30 -mx-4 sm:mx-0 mb-6 bg-brand-cream border-y sm:border border-brand-primary/15 sm:rounded-2xl shadow-sm px-4 py-3'}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="lg:hidden w-full flex items-center justify-between gap-3 rounded-xl border border-brand-primary/20 bg-white px-3 py-2 text-left"
      >
        <span className="min-w-0 text-sm font-bold text-brand-dark truncate">
          {formatStayDate(stay.checkIn)} – {formatStayDate(stay.checkOut)} · {describeGuests(stay)}
        </span>
        <span className="flex items-center gap-1 text-xs font-bold text-brand-primary shrink-0">
          <Pencil className="w-3.5 h-3.5" aria-hidden /> {expanded ? 'Close' : 'Edit'}
        </span>
      </button>
      <div className={`${expanded ? 'grid' : 'hidden'} lg:grid mt-2 lg:mt-0 grid-cols-2 lg:grid-cols-[1fr_1fr_0.8fr_0.8fr_auto] gap-2 items-end`}>
        <div>
          <span className={label}>Check-in</span>
          <label className={field}>
            <Calendar className="w-4 h-4 shrink-0 text-brand-primary/70" aria-hidden />
            <input
              type="date"
              aria-label="Check-in date"
              className={input}
              value={draft.checkIn}
              min={today}
              required
              onChange={(e) => {
                const checkIn = e.target.value;
                if (!checkIn) return;
                setDraft((prev) => ({
                  ...prev,
                  checkIn,
                  checkOut: prev.checkOut > checkIn ? prev.checkOut : format(addDays(parseISO(checkIn), 1), 'yyyy-MM-dd'),
                }));
              }}
            />
          </label>
        </div>
        <div>
          <span className={label}>Check-out</span>
          <label className={field}>
            <Calendar className="w-4 h-4 shrink-0 text-brand-primary/70" aria-hidden />
            <input
              type="date"
              aria-label="Check-out date"
              className={input}
              value={draft.checkOut}
              min={minCheckOut}
              required
              onChange={(e) => e.target.value && setDraft((prev) => ({ ...prev, checkOut: e.target.value }))}
            />
          </label>
        </div>
        <div>
          <span className={label}>Adults</span>
          <label className={field}>
            <Users className="w-4 h-4 shrink-0 text-brand-primary/70" aria-hidden />
            <select
              aria-label="Adults"
              className={input}
              value={draft.adults}
              onChange={(e) => setDraft((prev) => ({ ...prev, adults: Number(e.target.value) }))}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} adult{n === 1 ? '' : 's'}</option>)}
            </select>
          </label>
        </div>
        <div>
          <span className={label}>Children</span>
          <label className={field}>
            <select
              aria-label="Children"
              className={input}
              value={draft.children}
              onChange={(e) => setDraft((prev) => ({ ...prev, children: Number(e.target.value) }))}
            >
              {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'child' : 'children'}</option>)}
            </select>
          </label>
        </div>
        <button type="submit" className="col-span-2 lg:col-span-1 btn-primary py-3 px-6 flex items-center justify-center gap-2">
          <Search className="w-4 h-4" aria-hidden /> Search
        </button>
      </div>
      {!embedded && <p className="hidden lg:block mt-2 text-[11px] font-bold text-brand-dark/45">1 room per reservation</p>}
    </form>
  );
}
