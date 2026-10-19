import { useMemo, useState } from 'react';
import { BedDouble, Check, Coffee, ShieldCheck, Users } from 'lucide-react';
import type { HotelDetailCategory } from '../../services/api';
import { NO_PHOTO_SRC, showNoPhoto } from '../../lib/hotelImage';
import { describeGuests, formatStayDate, peso, stayNights, type Stay } from '../../lib/stayParams';

type SortKey = 'price-asc' | 'price-desc';
/** 'stay' = the selected dates; 'block' = one hourly block on the check-in day (hourly rooms). */
export type ReserveMode = 'stay' | 'block';
type Selection = { id: string; mode: ReserveMode };

/** Server price for the chosen option (never recalculated here). */
function priceFor(category: HotelDetailCategory, mode: ReserveMode): number | null {
  return mode === 'block' ? category.hourly?.blockPrice ?? null : stayTotal(category);
}

function optionLabel(category: HotelDetailCategory, mode: ReserveMode, stay: Stay, nights: number): string {
  if (mode === 'block' && category.hourly) {
    return `${category.hourly.blockHours}-hour stay on ${formatStayDate(stay.checkIn)}`;
  }
  return `${nights} night${nights === 1 ? '' : 's'}`;
}

/** Price for the stay, always from the server (never recalculated here); null when it sent none. */
function stayTotal(category: HotelDetailCategory): number | null {
  return category.stayPrice?.total ?? null;
}

function priceLabel(category: HotelDetailCategory): string {
  const total = stayTotal(category);
  return total == null ? '—' : peso(total);
}

function fitsParty(category: HotelDetailCategory, stay: Stay): boolean {
  return !category.maxGuests || stay.adults + stay.children <= category.maxGuests;
}

function isBookable(category: HotelDetailCategory, stay: Stay): boolean {
  return category.availableRooms > 0 && fitsParty(category, stay) && stayTotal(category) != null;
}

/**
 * Booking.com-style "Rooms & Rates" (steps 2–3): filters and sort, then one row per room type
 * with Room type | Price for the stay | Your choices | Select rooms, and a sticky reserve panel.
 * One room per reservation, so "Select rooms" is 0 or 1.
 */
export default function RoomsAndRates({
  categories: allCategories,
  stay,
  onReserve,
}: {
  categories: HotelDetailCategory[];
  stay: Stay;
  onReserve: (category: HotelDetailCategory, mode: ReserveMode) => void;
}) {
  const nights = stayNights(stay);
  // Client rule: fully booked room types are hidden until a room frees up for these dates.
  const categories = useMemo(() => allCategories.filter((c) => c.availableRooms > 0), [allCategories]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [freeCancellationOnly, setFreeCancellationOnly] = useState(false);
  const [breakfastOnly, setBreakfastOnly] = useState(false);
  const [bedType, setBedType] = useState('');
  const [maxPrice, setMaxPrice] = useState(0);
  const [sort, setSort] = useState<SortKey>('price-asc');

  const bedTypes = useMemo(
    () => [...new Set(categories.map((c) => c.bedConfiguration).filter((b): b is string => Boolean(b)))],
    [categories],
  );
  const hasCancellationData = categories.some((c) => c.freeCancellation);
  const hasBreakfastData = categories.some((c) => c.breakfastIncluded);

  const visible = useMemo(() => {
    const rows = categories.filter((c) => (
      (!freeCancellationOnly || c.freeCancellation)
      && (!breakfastOnly || c.breakfastIncluded)
      && (!bedType || c.bedConfiguration === bedType)
      && (!maxPrice || (stayTotal(c) ?? Infinity) <= maxPrice)
    ));
    return rows.sort((a, b) => {
      // Rooms you can book always come first.
      const bookable = Number(isBookable(b, stay)) - Number(isBookable(a, stay));
      if (bookable !== 0) return bookable;
      const diff = (stayTotal(a) ?? Infinity) - (stayTotal(b) ?? Infinity);
      return sort === 'price-desc' ? -diff : diff;
    });
  }, [categories, freeCancellationOnly, breakfastOnly, bedType, maxPrice, sort, nights, stay]);

  const selectedCategory = categories.find((c) => c.id === selection?.id && isBookable(c, stay)) ?? null;
  const selected = selectedCategory && selection ? { category: selectedCategory, mode: selection.mode } : null;

  if (allCategories.length === 0) {
    return <p className="text-sm font-bold text-brand-dark/60">This hotel has no rooms listed yet.</p>;
  }
  if (categories.length === 0) {
    return (
      <p className="text-sm font-bold text-brand-dark/60 py-8 text-center border border-dashed border-brand-primary/20 rounded-xl">
        No rooms are available for your dates. Try different dates in the bar above.
      </p>
    );
  }

  const chip = (active: boolean) => `px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
    active ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-primary/25 text-brand-dark hover:border-brand-primary/50'
  }`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
      <div className="min-w-0">
        {/* Filters + sort */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {hasBreakfastData && (
            <button type="button" className={chip(breakfastOnly)} aria-pressed={breakfastOnly} onClick={() => setBreakfastOnly((v) => !v)}>
              Breakfast included
            </button>
          )}
          {bedTypes.length > 1 && (
            <select aria-label="Bed type" value={bedType} onChange={(e) => setBedType(e.target.value)}
              className="px-3 py-1.5 rounded-full border border-brand-primary/25 text-xs font-bold text-brand-dark bg-white">
              <option value="">Any bed type</option>
              {bedTypes.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <select aria-label="Maximum price for your stay" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="px-3 py-1.5 rounded-full border border-brand-primary/25 text-xs font-bold text-brand-dark bg-white">
            <option value={0}>Any price</option>
            {[1000, 2000, 3000, 5000, 10000].map((p) => <option key={p} value={p}>Up to {peso(p)}</option>)}
          </select>
          <select aria-label="Sort rooms" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="ml-auto px-3 py-1.5 rounded-full border border-brand-primary/25 text-xs font-bold text-brand-dark bg-white">
            <option value="price-asc">Price: lowest first</option>
            <option value="price-desc">Price: highest first</option>
          </select>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm font-bold text-brand-dark/60 py-8 text-center border border-dashed border-brand-primary/20 rounded-xl">
            No rooms match these filters.
          </p>
        ) : (
          <div className="rounded-xl border border-brand-primary/15 overflow-hidden">
            {/* Column headings (desktop) */}
            <div className="hidden md:grid grid-cols-[1.6fr_1fr_1.2fr_0.7fr] bg-brand-primary text-white text-[11px] font-bold uppercase tracking-wider">
              <div className="px-4 py-2.5">Room type</div>
              <div className="px-4 py-2.5">Price for {nights} night{nights === 1 ? '' : 's'}</div>
              <div className="px-4 py-2.5">Your choices</div>
              <div className="px-4 py-2.5">Select rooms</div>
            </div>
            {visible.map((category) => {
              const bookable = isBookable(category, stay);
              const isSelected = selected?.category.id === category.id;
              return (
                <div
                  key={category.id}
                  className={`grid grid-cols-1 md:grid-cols-[1.6fr_1fr_1.2fr_0.7fr] border-t border-brand-primary/10 first:border-t-0 md:first:border-t ${isSelected ? 'bg-brand-primary/5' : 'bg-white'} ${bookable ? '' : 'opacity-70'}`}
                >
                  {/* Room type */}
                  <div className="p-4 flex gap-3">
                    <img src={category.imageUrl || NO_PHOTO_SRC} alt={category.name} onError={showNoPhoto}
                      className="w-24 h-20 rounded-lg object-cover shrink-0" loading="lazy" />
                    <div className="min-w-0">
                      <h3 className="font-bold text-brand-primary underline-offset-2">{category.name}</h3>
                      <ul className="mt-1 space-y-0.5 text-xs font-bold text-brand-dark/65">
                        {category.bedConfiguration && <li className="flex items-center gap-1.5"><BedDouble className="w-3.5 h-3.5" aria-hidden />{category.bedConfiguration}</li>}
                        {category.maxGuests ? <li className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" aria-hidden />Sleeps up to {category.maxGuests}</li> : null}
                      </ul>
                      {category.amenities && category.amenities.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-brand-dark/55 line-clamp-2 capitalize">
                          {category.amenities.slice(0, 6).map((a) => a.replace(/-/g, ' ')).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Price */}
                  <div className="px-4 pb-2 md:p-4 md:border-l border-brand-primary/10">
                    <p className="text-xl font-bold text-brand-dark tabular-nums">{priceLabel(category)}</p>
                    <p className="text-[11px] font-bold text-brand-dark/55">{nights} night{nights === 1 ? '' : 's'}, {describeGuests(stay)}</p>
                    <p className="text-[11px] font-bold text-brand-dark/45">Taxes and charges included</p>
                    {category.hourly && (
                      <p className="mt-1 text-[11px] font-bold text-brand-primary">
                        Hourly room · {peso(category.hourly.blockPrice)} per {category.hourly.blockHours} hours
                      </p>
                    )}
                  </div>

                  {/* Your choices */}
                  <div className="px-4 pb-2 md:p-4 md:border-l border-brand-primary/10 text-xs font-bold space-y-1">
                    {category.breakfastIncluded && <p className="flex items-center gap-1.5 text-brand-success"><Coffee className="w-3.5 h-3.5" aria-hidden />Breakfast included</p>}
                    <p className="text-brand-danger">Non-refundable</p>
                    <p className="flex items-center gap-1.5 text-brand-success"><Check className="w-3.5 h-3.5" aria-hidden />Pay by GCash or Maya QR</p>
                    {/* Client rule: always this wording, whatever the real count. */}
                    <p className="text-brand-danger">Only 1 room available</p>
                  </div>

                  {/* Select rooms */}
                  <div className="px-4 pb-4 md:p-4 md:border-l border-brand-primary/10">
                    {bookable ? (
                      <select
                        aria-label={`Rooms of ${category.name}`}
                        value={isSelected && selection ? selection.mode : ''}
                        onChange={(e) => setSelection(e.target.value ? { id: category.id, mode: e.target.value as ReserveMode } : null)}
                        className="w-full md:w-auto px-3 py-2 rounded-lg border border-brand-primary/30 text-sm font-bold bg-white"
                      >
                        <option value="">0</option>
                        <option value="stay">1 ({priceLabel(category)})</option>
                        {category.hourly && (
                          <option value="block">1 × {category.hourly.blockHours} h on {formatStayDate(stay.checkIn)} ({peso(category.hourly.blockPrice)})</option>
                        )}
                      </select>
                    ) : (
                      <p className="text-xs font-bold text-brand-danger">
                        {!fitsParty(category, stay) ? `Fits up to ${category.maxGuests} guests` : 'Price unavailable'}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reserve panel: sticky on desktop, bottom bar on phones */}
      <aside className="hidden lg:block lg:sticky lg:top-[96px] rounded-xl border border-brand-primary/15 bg-white p-4">
        <ReserveSummary selected={selected} nights={nights} stay={stay} onReserve={onReserve} />
      </aside>
      {selected && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-brand-primary/15 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(10,25,47,0.12)]">
          <ReserveSummary selected={selected} nights={nights} stay={stay} onReserve={onReserve} compact />
        </div>
      )}
    </div>
  );
}

function ReserveSummary({
  selected,
  nights,
  stay,
  onReserve,
  compact = false,
}: {
  selected: { category: HotelDetailCategory; mode: ReserveMode } | null;
  nights: number;
  stay: Stay;
  onReserve: (category: HotelDetailCategory, mode: ReserveMode) => void;
  compact?: boolean;
}) {
  const price = selected ? priceFor(selected.category, selected.mode) : null;
  const label = selected ? optionLabel(selected.category, selected.mode, stay, nights) : '';
  const button = (
    <button type="button" disabled={!selected} onClick={() => selected && onReserve(selected.category, selected.mode)}
      className="btn-primary w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
      Reserve
    </button>
  );
  if (compact && selected) {
    return (
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-brand-dark/60 truncate">1 × {selected.category.name} · {label}</p>
          <p className="text-lg font-bold text-brand-dark tabular-nums">{price == null ? '—' : peso(price)}</p>
        </div>
        <div className="w-36">{button}</div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {selected ? (
        <>
          <p className="text-sm font-bold text-brand-dark">1 room selected</p>
          <p className="text-xs font-bold text-brand-dark/60">{selected.category.name} · {label}, {describeGuests(stay)}</p>
          <p className="text-2xl font-bold text-brand-dark tabular-nums">{price == null ? '—' : peso(price)}</p>
          <p className="text-[11px] font-bold text-brand-dark/45">Taxes and charges included</p>
        </>
      ) : (
        <p className="text-sm font-bold text-brand-dark/60">Select a room to see your total.</p>
      )}
      {button}
      <p className="flex items-start gap-1.5 text-[11px] font-bold text-brand-dark/55">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-brand-success" aria-hidden />
        Next: your details, then pay by the hotel's GCash or Maya QR.
      </p>
    </div>
  );
}
