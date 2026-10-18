import { useMemo, useState } from 'react';
import { BedDouble, Check, Coffee, ShieldCheck, Users } from 'lucide-react';
import type { HotelDetailCategory } from '../../services/api';
import { NO_PHOTO_SRC, showNoPhoto } from '../../lib/hotelImage';
import { describeGuests, peso, stayNights, type Stay } from '../../lib/stayParams';

type SortKey = 'price-asc' | 'price-desc' | 'availability';

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
  categories,
  stay,
  onReserve,
}: {
  categories: HotelDetailCategory[];
  stay: Stay;
  onReserve: (category: HotelDetailCategory) => void;
}) {
  const nights = stayNights(stay);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      if (sort === 'availability') return b.availableRooms - a.availableRooms;
      const diff = (stayTotal(a) ?? Infinity) - (stayTotal(b) ?? Infinity);
      return sort === 'price-desc' ? -diff : diff;
    });
  }, [categories, freeCancellationOnly, breakfastOnly, bedType, maxPrice, sort, nights, stay]);

  const selected = categories.find((c) => c.id === selectedId && isBookable(c, stay)) ?? null;

  if (categories.length === 0) {
    return <p className="text-sm font-bold text-brand-dark/60">This hotel has no rooms listed yet.</p>;
  }

  const chip = (active: boolean) => `px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
    active ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-primary/25 text-brand-dark hover:border-brand-primary/50'
  }`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
      <div className="min-w-0">
        {/* Filters + sort */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {hasCancellationData && (
            <button type="button" className={chip(freeCancellationOnly)} aria-pressed={freeCancellationOnly} onClick={() => setFreeCancellationOnly((v) => !v)}>
              Free cancellation
            </button>
          )}
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
            <option value="availability">Most rooms available</option>
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
              const isSelected = selected?.id === category.id;
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
                  </div>

                  {/* Your choices */}
                  <div className="px-4 pb-2 md:p-4 md:border-l border-brand-primary/10 text-xs font-bold space-y-1">
                    {category.breakfastIncluded && <p className="flex items-center gap-1.5 text-brand-success"><Coffee className="w-3.5 h-3.5" aria-hidden />Breakfast included</p>}
                    {category.freeCancellation && <p className="flex items-center gap-1.5 text-brand-success"><Check className="w-3.5 h-3.5" aria-hidden />Free cancellation</p>}
                    <p className="flex items-center gap-1.5 text-brand-success"><Check className="w-3.5 h-3.5" aria-hidden />No payment until the hotel confirms</p>
                    {category.availableRooms > 0 && category.availableRooms <= 3 && (
                      <p className="text-brand-danger">Only {category.availableRooms} left for your dates</p>
                    )}
                  </div>

                  {/* Select rooms */}
                  <div className="px-4 pb-4 md:p-4 md:border-l border-brand-primary/10">
                    {bookable ? (
                      <select
                        aria-label={`Rooms of ${category.name}`}
                        value={isSelected ? 1 : 0}
                        onChange={(e) => setSelectedId(Number(e.target.value) > 0 ? category.id : null)}
                        className="w-full md:w-auto px-3 py-2 rounded-lg border border-brand-primary/30 text-sm font-bold bg-white"
                      >
                        <option value={0}>0</option>
                        <option value={1}>1 ({priceLabel(category)})</option>
                      </select>
                    ) : (
                      <p className="text-xs font-bold text-brand-danger">
                        {category.availableRooms === 0
                          ? 'Not available for your dates'
                          : !fitsParty(category, stay) ? `Fits up to ${category.maxGuests} guests` : 'Price unavailable'}
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
  selected: HotelDetailCategory | null;
  nights: number;
  stay: Stay;
  onReserve: (category: HotelDetailCategory) => void;
  compact?: boolean;
}) {
  const button = (
    <button type="button" disabled={!selected} onClick={() => selected && onReserve(selected)}
      className="btn-primary w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
      Reserve
    </button>
  );
  if (compact && selected) {
    return (
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-brand-dark/60 truncate">1 × {selected.name} · {nights} night{nights === 1 ? '' : 's'}</p>
          <p className="text-lg font-bold text-brand-dark tabular-nums">{priceLabel(selected)}</p>
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
          <p className="text-xs font-bold text-brand-dark/60">{selected.name} · {nights} night{nights === 1 ? '' : 's'}, {describeGuests(stay)}</p>
          <p className="text-2xl font-bold text-brand-dark tabular-nums">{priceLabel(selected)}</p>
          <p className="text-[11px] font-bold text-brand-dark/45">Taxes and charges included</p>
        </>
      ) : (
        <p className="text-sm font-bold text-brand-dark/60">Select a room to see your total.</p>
      )}
      {button}
      <p className="flex items-start gap-1.5 text-[11px] font-bold text-brand-dark/55">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-brand-success" aria-hidden />
        You won't be charged yet — you pay only after the hotel confirms.
      </p>
    </div>
  );
}
