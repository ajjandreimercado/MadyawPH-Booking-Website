import { useEffect, useRef, useState, useTransition } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, SlidersHorizontal, MapPin, Star, ChevronDown,
  Wifi, Utensils, Dumbbell, Waves, ParkingCircle, Wine,
  Grid3X3, List, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { searchHotels, fetchFilters, type SearchResultHotel, type SearchParams } from '../services/api';
import { formatHotelLocation, hotelCardImageSrc } from '../lib/hotelImage';
import StarRating from '../components/ui/StarRating';
import { HotelCardSkeleton } from '../components/ui/Skeleton';
import { cacheKey, peekCache } from '../lib/queryCache';
import { format } from 'date-fns';
import { getCurrentPosition, isNearMeQuery } from '../lib/nearMe';
import { useToast } from '../components/ui/ToastProvider';
import { sanitize } from '../utils/sanitize';

const SORT_OPTIONS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'distance', label: 'Nearest first' },
  { value: 'price', label: 'Lowest Price' },
  { value: 'rating', label: 'Highest Rating' },
  { value: 'popular', label: 'Most Popular' },
];

const AMENITY_ICONS: Record<string, any> = {
  'wifi': Wifi,
  'wi-fi': Wifi,
  'restaurant': Utensils,
  'gym': Dumbbell,
  'pool': Waves,
  'parking': ParkingCircle,
  'bar': Wine,
  'breakfast': Utensils,
  'breakfast-included': Utensils,
  'air-conditioning': Star,
  'airconditioning': Star,
  'free-cancellation': Star,
  'spa': Star,
  'laundry': Star,
  'pet-friendly': Star,
};

function amenityIconKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_/]+/g, '-');
}

function formatLabel(value: string) {
  return value.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function HotelCard({
  hotel,
  view,
  distanceFromLabel,
  onSelect,
}: {
  hotel: SearchResultHotel;
  view: 'grid' | 'list';
  distanceFromLabel?: string;
  onSelect: (hotel: SearchResultHotel) => void;
}) {
  const [imgIndex, setImgIndex] = useState(0);
  const images = [
    ...(hotel.imageUrl ? [hotel.imageUrl] : []),
    ...(hotel.images || [])
  ];
  const displayImages = images.length > 0 ? images.map((src) => hotelCardImageSrc(src) ?? src) : ['/hero/slide-1.png'];
  const locationLabel = formatHotelLocation(hotel.location, hotel.city);
  const navigate = useNavigate();

  return (
    <div
      className={`bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm overflow-hidden ${view === 'list' ? 'flex flex-col sm:flex-row gap-0' : ''}`}
    >
      {/* Image */}
      <div className={`relative overflow-hidden group ${view === 'list' ? 'w-full sm:w-56 md:w-64 shrink-0 h-48 sm:h-auto sm:min-h-[200px]' : 'h-52'}`}>
        <img
          src={displayImages[imgIndex]}
          alt={hotel.name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).src = '/hero/slide-1.png'; }}
        />
        {displayImages.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setImgIndex(p => (p - 1 + displayImages.length) % displayImages.length); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setImgIndex(p => (p + 1) % displayImages.length); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
        {hotel.availableRooms > 0 ? (
          <span className="absolute top-3 left-3 px-2 py-1 bg-brand-success/90 text-white text-[10px] font-bold uppercase tracking-wider rounded-full">
            {hotel.availableRooms} rooms left
          </span>
        ) : (
          <span className="absolute top-3 left-3 px-2 py-1 bg-brand-danger/90 text-white text-[10px] font-bold uppercase tracking-wider rounded-full">
            Fully booked
          </span>
        )}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-brand-dark/80 text-white text-sm font-bold px-2.5 py-1.5 rounded-lg shadow-md">
          <Star className="w-3.5 h-3.5 fill-brand-star text-brand-star" />
          {hotel.avgRating > 0 ? hotel.avgRating.toFixed(1) : 'New'}
          {hotel.totalReviews > 0 && (
            <span className="text-[10px] font-bold text-white/70">({hotel.totalReviews})</span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className={`p-5 flex flex-col justify-between flex-1 ${view === 'list' ? 'min-h-[200px]' : ''}`}>
        <div>
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="font-serif font-bold text-lg text-brand-dark leading-snug line-clamp-2">{hotel.name}</h3>
          </div>
          <p className="flex items-center gap-1.5 text-xs font-bold text-brand-dark/60 mb-1 min-w-0">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate" title={hotel.location}>{locationLabel}</span>
          </p>
          {typeof hotel.distanceKm === 'number' && (
            <p className="text-xs font-bold text-brand-primary mb-3">
              {hotel.distanceKm < 1
                ? `${Math.round(hotel.distanceKm * 1000)} m`
                : `${hotel.distanceKm} km`}
              {distanceFromLabel ? ` from ${distanceFromLabel}` : ' away'}
            </p>
          )}
          {hotel.totalReviews > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <StarRating rating={hotel.avgRating} size="sm" />
              <span className="text-xs text-brand-dark/50 font-bold">({hotel.totalReviews} reviews)</span>
            </div>
          )}
          {hotel.roomTypes.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {hotel.roomTypes.slice(0, 3).map(rt => (
                <span key={rt} className="px-2 py-0.5 bg-brand-primary/8 text-brand-primary text-[10px] font-bold uppercase tracking-wider rounded-full border border-brand-primary/15">
                  {rt.replace(/-/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-end justify-between gap-3 pt-3 border-t border-brand-primary/8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/40">Starting from</p>
            <p className="price-tag">₱{hotel.minPrice.toLocaleString()}<span className="text-xs font-sans font-bold text-brand-dark/50">/night</span></p>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/hotels/${hotel.id}`)}
            disabled={hotel.availableRooms === 0}
            className="btn-primary text-xs whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            View Rooms
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();

  const [hotels, setHotels] = useState<SearchResultHotel[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [showFilters, setShowFilters] = useState(false);
  const [dynamicRoomTypes, setDynamicRoomTypes] = useState<string[]>([]);
  const [dynamicAmenities, setDynamicAmenities] = useState<string[]>([]);
  const [priceBounds, setPriceBounds] = useState<{ min?: number; max?: number }>({});
  const [supportsFreeCancellation, setSupportsFreeCancellation] = useState(true);
  const [supportsBreakfastIncluded, setSupportsBreakfastIncluded] = useState(true);
  const [searchAnchor, setSearchAnchor] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [sortedByDistance, setSortedByDistance] = useState(false);

  // Filter state (controlled from URL params)
  const destination = searchParams.get('destination') ?? '';
  const checkIn = searchParams.get('checkIn') ?? '';
  const checkOut = searchParams.get('checkOut') ?? '';
  const guests = searchParams.get('guests') ?? '2';
  const sort = (searchParams.get('sort') ?? 'recommended') as SearchParams['sort'];
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const nearMe = searchParams.get('near') === '1';
  const nearLat = searchParams.get('lat');
  const nearLng = searchParams.get('lng');
  const radiusKm = Number(searchParams.get('radiusKm') ?? 50) || 50;

  const [localDestination, setLocalDestination] = useState(destination);
  const [priceMin, setPriceMin] = useState(Number(searchParams.get('priceMin') ?? 0));
  const [priceMax, setPriceMax] = useState(Number(searchParams.get('priceMax') ?? 0));
  const [selectedType, setSelectedType] = useState(searchParams.get('type') ?? '');
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>(
    searchParams.get('amenities') ? searchParams.get('amenities')!.split(',') : []
  );
  const [minRating, setMinRating] = useState(Number(searchParams.get('rating') ?? 0));
  const [freeCancellation, setFreeCancellation] = useState(searchParams.get('freeCancellation') === 'true');
  const [breakfastIncluded, setBreakfastIncluded] = useState(searchParams.get('breakfastIncluded') === 'true');
  const priceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep filter UI in sync when URL changes (back/forward, clear from empty state).
  useEffect(() => {
    setPriceMin(Number(searchParams.get('priceMin') ?? 0));
    setPriceMax(Number(searchParams.get('priceMax') ?? 0));
    setSelectedType(searchParams.get('type') ?? '');
    setSelectedAmenities(searchParams.get('amenities') ? searchParams.get('amenities')!.split(',') : []);
    setMinRating(Number(searchParams.get('rating') ?? 0));
    setFreeCancellation(searchParams.get('freeCancellation') === 'true');
    setBreakfastIncluded(searchParams.get('breakfastIncluded') === 'true');
  }, [searchParams]);

  const pushFilterParams = (patch: {
    priceMin?: number;
    priceMax?: number;
    type?: string;
    amenities?: string[];
    rating?: number;
    freeCancellation?: boolean;
    breakfastIncluded?: boolean;
  }) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const priceMinVal = patch.priceMin ?? priceMin;
      const priceMaxVal = patch.priceMax ?? priceMax;
      const typeVal = patch.type !== undefined ? patch.type : selectedType;
      const amenitiesVal = patch.amenities !== undefined ? patch.amenities : selectedAmenities;
      const ratingVal = patch.rating !== undefined ? patch.rating : minRating;
      const freeCancelVal = patch.freeCancellation !== undefined ? patch.freeCancellation : freeCancellation;
      const breakfastVal = patch.breakfastIncluded !== undefined ? patch.breakfastIncluded : breakfastIncluded;

      if (priceMinVal > 0) next.set('priceMin', String(priceMinVal)); else next.delete('priceMin');
      if (priceMaxVal > 0) next.set('priceMax', String(priceMaxVal)); else next.delete('priceMax');
      if (typeVal) next.set('type', typeVal); else next.delete('type');
      if (amenitiesVal.length > 0) next.set('amenities', amenitiesVal.join(',')); else next.delete('amenities');
      if (ratingVal > 0) next.set('rating', String(ratingVal)); else next.delete('rating');
      if (freeCancelVal) next.set('freeCancellation', 'true'); else next.delete('freeCancellation');
      if (breakfastVal) next.set('breakfastIncluded', 'true'); else next.delete('breakfastIncluded');
      next.set('page', '1');
      return next;
    });
  };

  const schedulePriceFilterUpdate = (min: number, max: number) => {
    if (priceDebounceRef.current) clearTimeout(priceDebounceRef.current);
    priceDebounceRef.current = setTimeout(() => {
      pushFilterParams({ priceMin: min, priceMax: max });
    }, 400);
  };

  useEffect(() => {
    setLocalDestination(nearMe ? 'Hotels near me' : destination);
  }, [nearMe, destination]);

  // near=1 without coords would show misleading "near you" results — recover location or clear flag.
  useEffect(() => {
    if (!nearMe || (nearLat && nearLng)) return;
    let cancelled = false;
    void (async () => {
      try {
        const position = await getCurrentPosition();
        if (cancelled) return;
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('near', '1');
          next.set('lat', String(position.coords.latitude));
          next.set('lng', String(position.coords.longitude));
          next.set('sort', 'distance');
          return next;
        });
      } catch {
        if (cancelled) return;
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('near');
          next.delete('lat');
          next.delete('lng');
          return next;
        });
        showToast({
          title: 'Location needed',
          description: 'Allow location access for near-me search, or type a destination.',
          type: 'error',
        });
      }
    })();
    return () => { cancelled = true; };
  }, [nearMe, nearLat, nearLng, setSearchParams, showToast]);

  const updateParam = (key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.set('page', '1');
      return next;
    });
  };

  const submitDestinationSearch = async () => {
    const safe = sanitize(localDestination);
    if (isNearMeQuery(safe)) {
      try {
        const position = await getCurrentPosition();
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('destination');
          next.set('near', '1');
          next.set('lat', String(position.coords.latitude));
          next.set('lng', String(position.coords.longitude));
          next.set('sort', 'distance');
          next.set('page', '1');
          return next;
        });
        setLocalDestination('Hotels near me');
      } catch {
        showToast({
          title: 'Location needed',
          description: 'Allow location access to find hotels near you, or type a city name.',
          type: 'error',
        });
      }
      return;
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('near');
      next.delete('lat');
      next.delete('lng');
      if (safe) {
        next.set('destination', safe);
        next.set('sort', 'distance');
      } else {
        next.delete('destination');
        next.delete('sort');
      }
      next.set('page', '1');
      return next;
    });
  };

  const clearFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      if (prev.get('destination')) next.set('destination', prev.get('destination')!);
      if (prev.get('near')) next.set('near', prev.get('near')!);
      if (prev.get('lat')) next.set('lat', prev.get('lat')!);
      if (prev.get('lng')) next.set('lng', prev.get('lng')!);
      if (prev.get('radiusKm')) next.set('radiusKm', prev.get('radiusKm')!);
      if (prev.get('checkIn')) next.set('checkIn', prev.get('checkIn')!);
      if (prev.get('checkOut')) next.set('checkOut', prev.get('checkOut')!);
      if (prev.get('guests')) next.set('guests', prev.get('guests')!);
      if (prev.get('sort')) next.set('sort', prev.get('sort')!);
      return next;
    });
  };

  useEffect(() => {
    fetchFilters().then(res => {
      setDynamicRoomTypes(res.roomTypes ?? []);
      setDynamicAmenities(res.amenities ?? []);
      setPriceBounds({
        min: res.priceMin,
        max: res.priceMax,
      });
      setSupportsFreeCancellation(res.supportsFreeCancellation !== false);
      setSupportsBreakfastIncluded(res.supportsBreakfastIncluded !== false);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    let isActive = true;
    const params: SearchParams = {
      destination: nearMe ? undefined : (searchParams.get('destination') ?? undefined),
      lat: nearMe && nearLat ? Number(nearLat) : undefined,
      lng: nearMe && nearLng ? Number(nearLng) : undefined,
      radiusKm: nearMe ? radiusKm : undefined,
      priceMin: Number(searchParams.get('priceMin')) || undefined,
      priceMax: Number(searchParams.get('priceMax')) || undefined,
      type: searchParams.get('type') ?? undefined,
      amenities: searchParams.get('amenities') ?? undefined,
      rating: Number(searchParams.get('rating')) || undefined,
      freeCancellation: searchParams.get('freeCancellation') === 'true' || undefined,
      breakfastIncluded: searchParams.get('breakfastIncluded') === 'true' || undefined,
      sort: nearMe ? 'distance' : ((searchParams.get('sort') as SearchParams['sort']) ?? 'recommended'),
      page,
      limit: 12,
    };

    const cached = peekCache<{
      data: SearchResultHotel[];
      total: number;
      totalPages: number;
      searchAnchor?: { lat: number; lng: number; label: string };
      sortedByDistance?: boolean;
    }>(cacheKey(['searchHotels', params]));

    if (cached) {
      setHotels(cached.data);
      setTotal(cached.total);
      setTotalPages(cached.totalPages);
      setSearchAnchor(cached.searchAnchor ?? null);
      setSortedByDistance(Boolean(cached.sortedByDistance));
      setIsLoading(false);
      setIsRefreshing(true);
    } else if (hotels.length > 0) {
      setIsRefreshing(true);
      setIsLoading(false);
    } else {
      setIsLoading(true);
      setIsRefreshing(false);
    }

    searchHotels(params).then(result => {
      if (!isActive) return;
      startTransition(() => {
        setHotels(result.data);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setSearchAnchor(result.searchAnchor ?? null);
        setSortedByDistance(Boolean(result.sortedByDistance));
      });
    }).catch(() => {
      if (isActive && !cached) {
        setHotels([]);
        setTotal(0);
        setTotalPages(0);
        setSearchAnchor(null);
        setSortedByDistance(false);
      }
    }).finally(() => {
      if (isActive) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    });

    return () => { isActive = false; };
  }, [searchParams, page]);

  const activeFilterCount = [
    Number(searchParams.get('priceMin')) > 0,
    Number(searchParams.get('priceMax')) > 0,
    Boolean(searchParams.get('type')),
    Boolean(searchParams.get('amenities')),
    Number(searchParams.get('rating')) > 0,
    searchParams.get('freeCancellation') === 'true',
    searchParams.get('breakfastIncluded') === 'true',
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-brand-background">
      {/* Search Header */}
      <div className="sticky z-30 top-[68px] sm:top-[76px] bg-brand-surface border-b border-brand-primary/10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 min-w-[12rem] max-w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-primary/60" />
              <input
                type="text"
                value={localDestination}
                onChange={e => setLocalDestination(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void submitDestinationSearch()}
                placeholder="Search destination or “hotels near me”…"
                className="pl-9 pr-4 py-2 w-full rounded-xl border border-brand-primary/20 bg-brand-background text-sm text-brand-dark focus:outline-none focus:border-brand-primary"
              />
            </div>
            {nearMe && (
              <span className="text-xs font-bold text-brand-primary whitespace-nowrap">Near me · {radiusKm} km</span>
            )}
            {checkIn && checkOut && (
              <span className="text-xs font-bold text-brand-dark/60 hidden md:block whitespace-nowrap">
                {checkIn} → {checkOut} · {guests} guests
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-colors ${activeFilterCount > 0 ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-primary/20 text-brand-dark hover:border-brand-primary/40'}`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
            </button>

            <div className="relative">
              <select
                value={sort}
                onChange={e => updateParam('sort', e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-brand-primary/20 text-sm font-bold text-brand-dark bg-brand-cream focus:outline-none"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-primary/60 pointer-events-none" />
            </div>

            <div className="flex border border-brand-primary/20 rounded-xl overflow-hidden">
              <button type="button" onClick={() => startTransition(() => setView('grid'))} className={`p-2 ${view === 'grid' ? 'bg-brand-primary text-white' : 'text-brand-dark/60 hover:bg-brand-primary/5'}`}>
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => startTransition(() => setView('list'))} className={`p-2 ${view === 'list' ? 'bg-brand-primary text-white' : 'text-brand-dark/60 hover:bg-brand-primary/5'}`}>
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter Panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-brand-primary/10 bg-brand-cream"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Price Range */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-3">Price per night (₱)</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder={priceBounds.min ? String(priceBounds.min) : 'Min'}
                      value={priceMin || ''}
                      onChange={(e) => {
                        const min = Number(e.target.value);
                        setPriceMin(min);
                        schedulePriceFilterUpdate(min, priceMax);
                      }}
                      className="input-field text-xs py-2 px-3 w-full"
                    />
                    <span className="text-brand-dark/40 font-bold">–</span>
                    <input
                      type="number"
                      placeholder={priceBounds.max ? String(priceBounds.max) : 'Max'}
                      value={priceMax || ''}
                      onChange={(e) => {
                        const max = Number(e.target.value);
                        setPriceMax(max);
                        schedulePriceFilterUpdate(priceMin, max);
                      }}
                      className="input-field text-xs py-2 px-3 w-full"
                    />
                  </div>
                  {priceBounds.min != null && priceBounds.max != null && (
                    <p className="mt-2 text-[10px] font-bold text-brand-dark/40">
                      Partner rooms from ₱{priceBounds.min.toLocaleString()} – ₱{priceBounds.max.toLocaleString()}
                    </p>
                  )}
                </div>

                {/* Room Type */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-3">Room Type</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {dynamicRoomTypes.length === 0 ? (
                      <p className="text-xs font-bold text-brand-dark/40">No room types listed yet</p>
                    ) : (
                      dynamicRoomTypes.map(rt => (
                        <label key={rt} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="roomType" value={rt} checked={selectedType === rt} onChange={() => { setSelectedType(rt); pushFilterParams({ type: rt }); }} className="accent-brand-primary" />
                          <span className="text-sm font-bold text-brand-dark">{formatLabel(rt)}</span>
                        </label>
                      ))
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="roomType" value="" checked={selectedType === ''} onChange={() => { setSelectedType(''); pushFilterParams({ type: '' }); }} className="accent-brand-primary" />
                      <span className="text-sm font-bold text-brand-dark">Any type</span>
                    </label>
                  </div>
                </div>

                {/* Amenities */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-3">Amenities</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {dynamicAmenities.length === 0 ? (
                      <p className="text-xs font-bold text-brand-dark/40 leading-relaxed">
                        Partner hotels have not listed amenities yet. Use room type, price, and the options on the right.
                      </p>
                    ) : (
                      dynamicAmenities.map(a => {
                        const IconComponent = AMENITY_ICONS[amenityIconKey(a)] || Star;
                        return (
                          <label key={a} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedAmenities.includes(a)}
                              onChange={() => {
                                const next = selectedAmenities.includes(a)
                                  ? selectedAmenities.filter((x) => x !== a)
                                  : [...selectedAmenities, a];
                                setSelectedAmenities(next);
                                pushFilterParams({ amenities: next });
                              }}
                              className="accent-brand-primary"
                            />
                            <IconComponent className="w-3.5 h-3.5 text-brand-primary/60" />
                            <span className="text-sm font-bold text-brand-dark">{formatLabel(a)}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Misc Filters */}
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-3">Min Rating</p>
                    <div className="flex gap-2">
                      {[0, 3, 4, 5].map(r => (
                        <button key={r} type="button" onClick={() => { setMinRating(r); pushFilterParams({ rating: r }); }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${minRating === r ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-primary/20 text-brand-dark hover:border-brand-primary/40'}`}>
                          {r === 0 ? 'Any' : `${r}+`}
                        </button>
                      ))}
                    </div>
                  </div>
                  {supportsFreeCancellation && (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={freeCancellation} onChange={() => { const next = !freeCancellation; setFreeCancellation(next); pushFilterParams({ freeCancellation: next }); }} className="accent-brand-primary w-4 h-4" />
                      <span className="text-sm font-bold text-brand-dark">Free Cancellation</span>
                    </label>
                  )}
                  {supportsBreakfastIncluded && (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={breakfastIncluded} onChange={() => { const next = !breakfastIncluded; setBreakfastIncluded(next); pushFilterParams({ breakfastIncluded: next }); }} className="accent-brand-primary w-4 h-4" />
                      <span className="text-sm font-bold text-brand-dark">Breakfast Included</span>
                    </label>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-semibold text-brand-dark">
              {nearMe
                ? 'Hotels near you'
                : searchAnchor
                  ? `Hotels near ${searchAnchor.label}`
                  : destination
                    ? `Properties in "${destination}"`
                    : 'All Properties'}
            </h1>
            {!isLoading && (
              <p className="text-sm font-bold text-brand-dark/50 mt-1">
                {isRefreshing ? 'Updating results… · ' : ''}
                {nearMe
                  ? `${total} ${total === 1 ? 'hotel' : 'hotels'} within ${radiusKm} km · nearest first`
                  : sortedByDistance && searchAnchor
                    ? `${total} ${total === 1 ? 'hotel' : 'hotels'} · nearest to farthest from ${searchAnchor.label}`
                    : `${total} ${total === 1 ? 'property' : 'properties'} found`}
              </p>
            )}
          </div>
        </div>

        {isLoading && hotels.length === 0 ? (
          <div className={view === 'grid' ? 'fluid-card-grid' : 'grid grid-cols-1 gap-5'}>
            {Array.from({ length: 6 }).map((_, i) => (
              <HotelCardSkeleton key={i} list={view === 'list'} />
            ))}
          </div>
        ) : hotels.length === 0 ? (
          <div className="py-20 flex flex-col items-center text-center">
            <Search className="w-16 h-16 text-brand-primary/20 mb-4" />
            <h2 className="text-2xl font-serif font-bold text-brand-dark mb-2">No properties found</h2>
            <p className="text-brand-dark/60 font-bold mb-6">Try adjusting your search or filters</p>
            <button type="button" onClick={clearFilters} className="btn-outline flex items-center gap-2">
              <X className="w-4 h-4" /> Clear all filters
            </button>
          </div>
        ) : (
          <div className={`${view === 'grid' ? 'fluid-card-grid' : 'grid grid-cols-1 gap-5'} ${isRefreshing ? 'opacity-70 transition-opacity' : ''}`}>
              {hotels.map(hotel => (
                <HotelCard
                  key={hotel.id}
                  hotel={hotel}
                  view={view}
                  distanceFromLabel={searchAnchor?.label}
                  onSelect={() => {}}
                />
              ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10">
            <button type="button" disabled={page <= 1} onClick={() => updateParam('page', String(page - 1))}
              className="p-2 rounded-xl border border-brand-primary/20 text-brand-dark disabled:opacity-40 hover:border-brand-primary transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
              const p = i + 1;
              return (
                <button key={p} type="button" onClick={() => updateParam('page', String(p))}
                  className={`w-10 h-10 rounded-xl text-sm font-bold border transition-colors ${page === p ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-primary/20 text-brand-dark hover:border-brand-primary/40'}`}>
                  {p}
                </button>
              );
            })}
            <button type="button" disabled={page >= totalPages} onClick={() => updateParam('page', String(page + 1))}
              className="p-2 rounded-xl border border-brand-primary/20 text-brand-dark disabled:opacity-40 hover:border-brand-primary transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
