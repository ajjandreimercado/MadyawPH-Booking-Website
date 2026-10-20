import { useEffect, useMemo, useState } from 'react';
import { BedDouble, ChevronLeft, ChevronRight, Coffee, Expand, ShieldCheck, Users, X } from 'lucide-react';
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

/** All photos the hotel uploaded for this room type (its own gallery, deduped). */
function photosOf(category: HotelDetailCategory): string[] {
  const photos = [...new Set([category.imageUrl, ...(category.images ?? [])].filter(Boolean) as string[])];
  return photos.length > 0 ? photos : [NO_PHOTO_SRC];
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

/** Max room types in one booking (mirrors the server cap). */
const MAX_SELECTED_CATEGORIES = 5;

export type ReserveItem = { category: HotelDetailCategory; mode: ReserveMode };

/**
 * Booking.com-style "Rooms & Rates" (steps 2–3): filters and sort, then one row per room type
 * with Room type | Price for the stay | Your choices | Select rooms, and a sticky reserve panel.
 * Guests may select several room types (one room each) and book them together in one
 * checkout with one payment; the hourly "block" option stays a single-type booking.
 */
export default function RoomsAndRates({
  categories: allCategories,
  stay,
  onReserve,
}: {
  categories: HotelDetailCategory[];
  stay: Stay;
  onReserve: (items: ReserveItem[]) => void;
}) {
  const nights = stayNights(stay);
  // Client rule: fully booked room types are hidden until a room frees up for these dates.
  const categories = useMemo(() => allCategories.filter((c) => c.availableRooms > 0), [allCategories]);
  const [selections, setSelections] = useState<Selection[]>([]);

  /** Add/replace one room type in the selection; hourly blocks always book on their own. */
  const applySelection = (category: HotelDetailCategory, mode: ReserveMode | null) => {
    setSelections((prev) => {
      if (mode === null) return prev.filter((s) => s.id !== category.id);
      if (mode === 'block') return [{ id: category.id, mode }];
      const staySelections = prev.filter((s) => s.mode === 'stay' && s.id !== category.id);
      if (staySelections.length >= MAX_SELECTED_CATEGORIES) return prev;
      return [...staySelections, { id: category.id, mode }];
    });
  };
  const [freeCancellationOnly, setFreeCancellationOnly] = useState(false);
  const [breakfastOnly, setBreakfastOnly] = useState(false);
  const [bedType, setBedType] = useState('');
  const [maxPrice, setMaxPrice] = useState(0);
  const [sort, setSort] = useState<SortKey>('price-asc');
  const [viewing, setViewing] = useState<{ category: HotelDetailCategory; index: number } | null>(null);

  useEffect(() => {
    if (!viewing) return;
    const count = photosOf(viewing.category).length;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewing(null);
      if (e.key === 'ArrowRight') setViewing((v) => (v ? { ...v, index: (v.index + 1) % count } : v));
      if (e.key === 'ArrowLeft') setViewing((v) => (v ? { ...v, index: (v.index - 1 + count) % count } : v));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewing]);

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

  const selectedItems: ReserveItem[] = selections.flatMap((selection) => {
    const category = categories.find((c) => c.id === selection.id && isBookable(c, stay));
    return category ? [{ category, mode: selection.mode }] : [];
  });
  const selectedIds = new Set(selectedItems.map((item) => item.category.id));

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
              <div className="px-4 py-2.5">Price</div>
              <div className="px-4 py-2.5">Your choices</div>
              <div className="px-4 py-2.5">Select rooms</div>
            </div>
            {visible.map((category) => {
              const bookable = isBookable(category, stay);
              const isSelected = selectedIds.has(category.id);
              const selectionMode = selections.find((s) => s.id === category.id)?.mode;
              return (
                <div
                  key={category.id}
                  onClick={() => { if (bookable && !isSelected) applySelection(category, 'stay'); }}
                  title={bookable && !isSelected ? 'Click to select this room and see its price' : undefined}
                  className={`grid grid-cols-1 md:grid-cols-[1.6fr_1fr_1.2fr_0.7fr] border-t border-brand-primary/10 first:border-t-0 md:first:border-t ${isSelected ? 'bg-brand-primary/5' : 'bg-white'} ${bookable ? 'cursor-pointer' : 'opacity-70'}`}
                >
                  {/* Room type — photo is the same large size as the hotel gallery image */}
                  <div className="p-4 flex flex-col gap-3">
                    {category.imageUrl ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setViewing({ category, index: 0 }); }}
                        aria-label={`View photos of ${category.name}`}
                        title="Click to view photo"
                        className="group relative block w-full h-56 sm:h-72 rounded-xl overflow-hidden cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                      >
                        <img src={category.imageUrl} alt={category.name} onError={showNoPhoto}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                        <span className="absolute inset-0 bg-brand-dark/0 group-hover:bg-brand-dark/35 transition-colors flex items-center justify-center">
                          <Expand className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                        </span>
                      </button>
                    ) : (
                      <img src={NO_PHOTO_SRC} alt={category.name} onError={showNoPhoto}
                        className="block w-full h-56 sm:h-72 rounded-xl object-cover" loading="lazy" />
                    )}
                    {photosOf(category).length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1" aria-label={`More photos of ${category.name}`}>
                        {photosOf(category).slice(0, 6).map((src, photoIndex) => (
                          <button
                            key={`${src}-${photoIndex}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setViewing({ category, index: photoIndex }); }}
                            aria-label={`View photo ${photoIndex + 1} of ${category.name}`}
                            className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                          >
                            <img src={src} alt="" onError={showNoPhoto} className="h-full w-full object-cover" loading="lazy" />
                          </button>
                        ))}
                        <span className="self-center text-[11px] font-bold text-brand-dark/50 shrink-0">
                          {photosOf(category).length} photos
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-bold text-brand-primary underline-offset-2">{category.name}</h3>
                      {category.description && (
                        <p className="mt-0.5 text-xs font-bold text-brand-dark/60 line-clamp-2">{category.description}</p>
                      )}
                      {category.hasPromo ? (
                        <p className="mt-1 text-xs font-bold text-brand-danger">
                          <span className="uppercase tracking-wider">Promo</span>
                          {/* Price stays hidden until the guest picks this room type. */}
                          {isSelected && category.promoPrice ? (
                            <>
                              {' '}· Starts from {peso(category.promoPrice)}
                              {category.promoRegularPrice && category.promoRegularPrice > category.promoPrice
                                ? <span className="ml-1.5 text-brand-dark/45 line-through">{peso(category.promoRegularPrice)}</span>
                                : null}
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      <ul className="mt-1 space-y-0.5 text-xs font-bold text-brand-dark/65">
                        {category.bedConfiguration && <li className="flex items-center gap-1.5"><BedDouble className="w-3.5 h-3.5" aria-hidden />{category.bedConfiguration}</li>}
                        {category.maxGuests ? <li className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" aria-hidden />Sleeps up to {category.maxGuests}</li> : null}
                      </ul>
                      {category.amenities && category.amenities.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-brand-dark/55 line-clamp-2 capitalize">
                          {category.amenities.slice(0, 6).map((a) => a.replace(/-/g, ' ')).join(' · ')}
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] font-bold text-brand-success">
                        {category.availableRooms} room{category.availableRooms === 1 ? '' : 's'} available for your dates
                      </p>
                      {(category.extraPersonCharge || category.extraBedCharge) && (
                        <p className="mt-0.5 text-[11px] font-bold text-brand-dark/55">
                          {category.extraPersonCharge ? `Extra person ${peso(category.extraPersonCharge)}` : ''}
                          {category.extraPersonCharge && category.extraBedCharge ? ' · ' : ''}
                          {category.extraBedCharge ? `Extra bed ${peso(category.extraBedCharge)}` : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Price — revealed only after the guest picks this room type */}
                  <div className="px-4 pb-2 md:p-4 md:border-l border-brand-primary/10">
                    {isSelected ? (
                      <>
                        <p className="text-xl font-bold text-brand-dark tabular-nums">{priceLabel(category)}</p>
                        {/* Room facts come from the category itself, not the searched dates/guests. */}
                        {category.description
                          ? <p className="text-[11px] font-bold text-brand-dark/55 line-clamp-2">{category.description}</p>
                          : null}
                        <p className="text-[11px] font-bold text-brand-dark/45">Taxes and charges included</p>
                        {category.hourly && (
                          <p className="mt-1 text-[11px] font-bold text-brand-primary">
                            Hourly room · {peso(category.hourly.blockPrice)} per {category.hourly.blockHours} hours
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm font-bold text-brand-primary">Select this room to see its price</p>
                    )}
                  </div>

                  {/* Your choices */}
                  <div className="px-4 pb-2 md:p-4 md:border-l border-brand-primary/10 text-xs font-bold space-y-1">
                    {category.breakfastIncluded && <p className="flex items-center gap-1.5 text-brand-success"><Coffee className="w-3.5 h-3.5" aria-hidden />Breakfast included</p>}
                  </div>

                  {/* Select rooms */}
                  <div className="px-4 pb-4 md:p-4 md:border-l border-brand-primary/10">
                    {bookable ? (
                      <select
                        aria-label={`Rooms of ${category.name}`}
                        value={isSelected && selectionMode ? selectionMode : ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => applySelection(category, e.target.value ? e.target.value as ReserveMode : null)}
                        className="w-full md:w-auto px-3 py-2 rounded-lg border border-brand-primary/30 text-sm font-bold bg-white"
                      >
                        <option value="">0</option>
                        <option value="stay">1</option>
                        {category.hourly && (
                          <option value="block">1 × {category.hourly.blockHours} h on {formatStayDate(stay.checkIn)}</option>
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
      <aside className="hidden lg:block lg:sticky lg:top-[12rem] rounded-xl border border-brand-primary/15 bg-white p-4">
        <ReserveSummary items={selectedItems} nights={nights} stay={stay} onReserve={onReserve} />
      </aside>
      {selectedItems.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-brand-primary/15 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(10,25,47,0.12)]">
          <ReserveSummary items={selectedItems} nights={nights} stay={stay} onReserve={onReserve} compact />
        </div>
      )}

      {/* Room photo gallery — every photo the hotel uploaded for this room type */}
      {viewing && (() => {
        const photos = photosOf(viewing.category);
        const index = Math.min(viewing.index, photos.length - 1);
        const go = (next: number) => setViewing({ category: viewing.category, index: ((next % photos.length) + photos.length) % photos.length });
        return (
          <div
            className="fixed inset-0 z-[100] bg-brand-dark/95 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`Photos of ${viewing.category.name}`}
            onClick={() => setViewing(null)}
          >
            <button
              type="button"
              className="absolute top-4 right-4 text-brand-cream hover:text-white p-1"
              onClick={() => setViewing(null)}
              aria-label="Close photos"
            >
              <X className="w-8 h-8" />
            </button>
            <figure className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
              <div className="relative">
                <img
                  src={photos[index]}
                  alt={viewing.category.name}
                  onError={showNoPhoto}
                  className="max-h-[72vh] w-full object-contain rounded-xl"
                />
                {photos.length > 1 && (
                  <>
                    <button type="button" aria-label="Previous photo" onClick={() => go(index - 1)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-brand-dark/60 text-white flex items-center justify-center hover:bg-brand-dark/85">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button type="button" aria-label="Next photo" onClick={() => go(index + 1)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-brand-dark/60 text-white flex items-center justify-center hover:bg-brand-dark/85">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    <span className="absolute bottom-2 right-2 rounded-full bg-brand-dark/70 px-2.5 py-1 text-[11px] font-bold text-white">
                      {index + 1} / {photos.length}
                    </span>
                  </>
                )}
              </div>
              <figcaption className="mt-3 text-center text-sm font-bold text-brand-cream">
                {viewing.category.name}
                {viewing.category.bedConfiguration ? <span className="block mt-0.5 text-xs font-bold text-brand-cream/60">{viewing.category.bedConfiguration}</span> : null}
              </figcaption>
              {photos.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 justify-start sm:justify-center">
                  {photos.map((src, photoIndex) => (
                    <button
                      key={`${src}-${photoIndex}`}
                      type="button"
                      onClick={() => go(photoIndex)}
                      aria-label={`Photo ${photoIndex + 1}`}
                      aria-current={photoIndex === index}
                      className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg focus:outline-none ${photoIndex === index ? 'ring-2 ring-brand-cream' : 'opacity-60 hover:opacity-100'}`}
                    >
                      <img src={src} alt="" onError={showNoPhoto} className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </figure>
          </div>
        );
      })()}
    </div>
  );
}

function ReserveSummary({
  items,
  nights,
  stay,
  onReserve,
  compact = false,
}: {
  items: ReserveItem[];
  nights: number;
  stay: Stay;
  onReserve: (items: ReserveItem[]) => void;
  compact?: boolean;
}) {
  const total = items.reduce((sum, item) => sum + (priceFor(item.category, item.mode) ?? 0), 0);
  const hasPrice = items.every((item) => priceFor(item.category, item.mode) != null);
  const button = (
    <button type="button" disabled={items.length === 0} onClick={() => items.length > 0 && onReserve(items)}
      className="btn-primary w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
      Reserve
    </button>
  );
  if (compact && items.length > 0) {
    return (
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-brand-dark/60 truncate">
            {items.length} room type{items.length === 1 ? '' : 's'} · {items.map((item) => item.category.name).join(', ')}
          </p>
          <p className="text-lg font-bold text-brand-dark tabular-nums">{hasPrice ? peso(total) : '—'}</p>
        </div>
        <div className="w-36">{button}</div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.length > 0 ? (
        <>
          <p className="text-sm font-bold text-brand-dark">
            {items.length} room type{items.length === 1 ? '' : 's'} selected · {describeGuests(stay)}
          </p>
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.category.id} className="flex items-baseline justify-between gap-2 text-xs font-bold">
                <span className="text-brand-dark/70 min-w-0">
                  <span className="block truncate">{item.category.name}</span>
                  <span className="text-brand-dark/45">{optionLabel(item.category, item.mode, stay, nights)}</span>
                </span>
                <span className="text-brand-dark tabular-nums shrink-0">
                  {priceFor(item.category, item.mode) == null ? '—' : peso(priceFor(item.category, item.mode)!)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-2xl font-bold text-brand-dark tabular-nums">{hasPrice ? peso(total) : '—'}</p>
          <p className="text-[11px] font-bold text-brand-dark/45">Taxes and charges included</p>
          {items.length >= 2 && (
            <p className="text-[11px] font-bold text-brand-primary">
              Booking {items.length} room types together — you can choose Individual or Group (50% down payment) at checkout.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm font-bold text-brand-dark/60">Select one or more room types to see your total.</p>
      )}
      {button}
      <p className="flex items-start gap-1.5 text-[11px] font-bold text-brand-dark/55">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-brand-success" aria-hidden />
        Next: your details, then pay by the hotel's GCash or Maya QR.
      </p>
    </div>
  );
}
