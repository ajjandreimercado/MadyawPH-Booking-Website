import { useEffect, useState, useTransition } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NO_PHOTO_SRC, showNoPhoto } from '../lib/hotelImage';
import { Loader2, MapPin, Phone, Star, ChevronLeft, ChevronRight, X, Wifi, Waves, Utensils, Dumbbell, ParkingCircle, Wind, Coffee, Tv, MessageSquareQuote, Clock, IdCard, Wallet } from 'lucide-react';
import { fetchHotelDetailById } from '../api/propertyService';
import { fetchReviews, type Review } from '../services/api';
import { errorMessageFromUnknown } from '../lib/apiError';
import type { Hotel } from '../types';
import type { HotelDetailResponse, HotelDetailCategory } from '../services/api';
import { useToast } from '../components/ui/ToastProvider';
import StarRating from '../components/ui/StarRating';
import { HotelDetailSkeleton } from '../components/ui/Skeleton';
import { cacheKey, peekCache } from '../lib/queryCache';
import { readStay, stayQuery, writeStay } from '../lib/stayParams';
import StayBar from '../components/booking/StayBar';
import RoomsAndRates, { type ReserveMode } from '../components/booking/RoomsAndRates';
import { buildGoogleMapsDirectionsUrl, getCurrentPosition, resolveHotelMapsDestination } from '../lib/nearMe';
import { removeRecentlyViewed, trackRecentlyViewed } from '../lib/recentlyViewed';

const AMENITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  wifi: Wifi, pool: Waves, restaurant: Utensils, gym: Dumbbell,
  parking: ParkingCircle, 'air-conditioning': Wind, bar: Coffee, tv: Tv,
  'beach-access': Waves, spa: Star, kitchen: Utensils, 'airport-shuttle': MapPin,
};

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'rooms', label: 'Rooms & Rates' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'house-rules', label: 'House Rules' },
  { id: 'reviews', label: 'Reviews' },
] as const;

function ImageGallery({
  images,
  hotelName,
  rating,
  reviewCount,
}: {
  images: string[];
  hotelName: string;
  rating?: number;
  reviewCount?: number;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  if (images.length === 0) {
    return (
      <img src={NO_PHOTO_SRC} alt="No photo attached" className="h-80 w-full object-cover rounded-2xl" />
    );
  }

  return (
    <>
      <div className="rounded-2xl overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-2 md:h-[400px]">
          {/* Main image */}
          <div
            className="md:col-span-2 md:row-span-2 relative cursor-pointer group overflow-hidden h-56 sm:h-72 md:h-auto"
            onClick={() => setLightbox(true)}
          >
            <img src={images[0]} alt={hotelName} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" onError={showNoPhoto} />
            <div className="absolute inset-0 bg-brand-dark/0 group-hover:bg-brand-dark/10 transition-colors" />
            <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-brand-dark/80 backdrop-blur-sm text-white font-bold px-3.5 py-2 rounded-xl shadow-lg">
              <Star className="w-5 h-5 fill-brand-star text-brand-star" />
              <span className="text-lg">{rating && rating > 0 ? rating.toFixed(1) : 'New'}</span>
              {reviewCount != null && reviewCount > 0 && (
                <span className="text-xs font-bold text-white/70">({reviewCount} reviews)</span>
              )}
            </div>
            {images.length > 1 && (
              <button
                type="button"
                className="md:hidden absolute bottom-4 right-4 bg-brand-dark/80 text-white text-xs font-bold px-3 py-2 rounded-xl"
                onClick={(e) => { e.stopPropagation(); setLightbox(true); }}
              >
                View {images.length} photos
              </button>
            )}
          </div>
          {/* Thumbnails — desktop/tablet only to avoid crushed mobile grid */}
          {images.slice(1, 5).map((img, i) => (
            <div key={i} className="relative cursor-pointer group overflow-hidden hidden md:block" onClick={() => { setActiveIdx(i + 1); setLightbox(true); }}>
              <img src={img} alt={`${hotelName} ${i + 2}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" onError={showNoPhoto} />
              {i === 3 && images.length > 5 && (
                <div className="absolute inset-0 bg-brand-dark/50 flex items-center justify-center">
                  <span className="text-brand-cream font-bold text-lg">+{images.length - 5}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-brand-dark/95 flex items-center justify-center" onClick={() => setLightbox(false)}>
          <button type="button" className="absolute top-4 right-4 text-brand-cream hover:text-brand-primary" onClick={() => setLightbox(false)}>
            <X className="w-8 h-8" />
          </button>
          <button type="button" className="absolute left-4 text-brand-cream hover:text-brand-primary" onClick={e => { e.stopPropagation(); setActiveIdx(p => (p - 1 + images.length) % images.length); }}>
            <ChevronLeft className="w-10 h-10" />
          </button>
          <img src={images[activeIdx]} alt="" className="max-h-[85vh] max-w-[85vw] object-contain rounded-xl" onClick={e => e.stopPropagation()} />
          <button type="button" className="absolute right-4 text-brand-cream hover:text-brand-primary" onClick={e => { e.stopPropagation(); setActiveIdx(p => (p + 1) % images.length); }}>
            <ChevronRight className="w-10 h-10" />
          </button>
          <p className="absolute bottom-6 text-brand-cream/70 text-sm font-bold">{activeIdx + 1} / {images.length}</p>
        </div>
      )}
    </>
  );
}

export default function HotelDetailPage() {
  const { hotelId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();

  // Dates and guests live in the URL (sticky stay bar), so refresh/share keeps them.
  const [searchParams, setSearchParams] = useSearchParams();
  const stay = readStay(searchParams);
  // Homepage / deep links without ?checkIn often fall back to session stay — write that into the URL once.
  useEffect(() => {
    if (searchParams.get('checkIn') && searchParams.get('checkOut') && searchParams.get('adults')) return;
    setSearchParams((prev) => writeStay(prev, stay), { replace: true });
    // Only when the URL is missing stay fields — not on every stay edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);
  const detailQuery = { checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults, children: stay.children };
  const cachedDetail = hotelId
    ? peekCache<HotelDetailResponse>(cacheKey(['hotel-detail', hotelId, detailQuery]))
    : undefined;
  const cachedReviews = hotelId
    ? peekCache<{ data: Review[]; total: number; totalPages: number }>(cacheKey(['reviews', { hotelId }]))
    : undefined;

  const [hotel, setHotel] = useState<Hotel | null>(cachedDetail?.hotel ?? null);
  const [categories, setCategories] = useState<HotelDetailCategory[]>(cachedDetail?.categories ?? []);
  const [reviews, setReviews] = useState<Review[]>(cachedReviews?.data ?? []);
  const [isLoading, setIsLoading] = useState(!cachedDetail);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpeningMaps, setIsOpeningMaps] = useState(false);

  // Collect all images across room categories
  const allImages = [
    ...(hotel?.imageUrl ? [hotel.imageUrl] : []),
    ...categories.map(c => c.imageUrl).filter(Boolean)
  ];
  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : 0;

  useEffect(() => {
    let isActive = true;
    if (!hotelId) return;

    const load = async () => {
      // Only the first load shows the full-page skeleton; stay changes refresh in place.
      if (!peekCache(cacheKey(['hotel-detail', hotelId, detailQuery])) && !hotel) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError(null);
      try {
        const [hotelDetail, reviewData] = await Promise.all([
          fetchHotelDetailById(hotelId, detailQuery),
          fetchReviews({ hotelId }).catch(() => ({ data: [], total: 0, totalPages: 0 })),
        ]);
        if (!isActive) return;
        startTransition(() => {
          setHotel(hotelDetail.hotel);
          setCategories(hotelDetail.categories);
          setReviews(reviewData.data);
        });
        trackRecentlyViewed(hotelDetail.hotel);
      } catch (err) {
        if (!isActive) return;
        if (hotelId) removeRecentlyViewed(hotelId);
        if (!cachedDetail) {
          setError(errorMessageFromUnknown(err, 'Unable to load hotel details right now.'));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    void load();
    return () => { isActive = false; };
  }, [hotelId, stay.checkIn, stay.checkOut, stay.adults, stay.children]);

  const openDirections = async () => {
    if (!hotel) return;
    // Real hotels → name + city. Test/unknown names → barangay/city (or coords).
    const { destinationQuery, destLat, destLng } = resolveHotelMapsDestination({
      name: hotel.name,
      location: hotel.location,
      city: hotel.city,
      latitude: hotel.latitude,
      longitude: hotel.longitude,
    });
    setIsOpeningMaps(true);
    try {
      let originLat: number | undefined;
      let originLng: number | undefined;
      try {
        const position = await getCurrentPosition({ timeout: 8000 });
        originLat = position.coords.latitude;
        originLng = position.coords.longitude;
      } catch {
        // Guest denied location — still open destination directions
      }
      const url = buildGoogleMapsDirectionsUrl({
        destinationQuery,
        destLat,
        destLng,
        originLat,
        originLng,
        label: hotel.name,
      });
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setIsOpeningMaps(false);
    }
  };

  // Guests book the room type; the server assigns a free room of that type.
  const handleReserve = (cat: HotelDetailCategory, mode: ReserveMode) => {
    if (cat.availableRooms <= 0) {
      showToast({ title: 'No rooms available', description: 'This room type is full for your dates.', type: 'info' });
      return;
    }
    // Hourly "block": one block on the check-in day (check-out = check-in date).
    const booked = mode === 'block' ? { ...stay, checkOut: stay.checkIn, block: true } : { ...stay, block: false };
    navigate(`/booking/${cat.id}?${stayQuery(booked)}`);
  };

  if (isLoading && !hotel) {
    return <HotelDetailSkeleton />;
  }

  if (error || !hotel) {
    return (
      <div className="min-h-screen pt-32 bg-brand-background flex items-center justify-center p-4">
        <div className="bg-brand-cream p-8 rounded-2xl shadow-md border border-red-200 text-center max-w-sm">
          <h2 className="text-xl font-serif font-bold text-brand-dark mb-2">Unable to load hotel</h2>
          <p className="text-sm font-bold text-brand-dark/70 mb-6">{error ?? 'Hotel not found.'}</p>
          <button onClick={() => navigate('/')} className="btn-primary w-full">Return Home</button>
        </div>
      </div>
    );
  }

  const allAmenities = Array.from(new Set(categories.flatMap(c => c.amenities ?? [])));
  const anyAvailable = categories.some(c => c.availableRooms > 0);
  const sectionCard = 'bg-brand-cream rounded-2xl p-5 sm:p-6 border border-brand-primary/10 scroll-mt-40';

  return (
    <div className="bg-brand-background min-h-screen pt-28 pb-28 lg:pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <StayBar stay={stay} onSearch={(next) => setSearchParams((prev) => writeStay(prev, next), { replace: true })} />

        {/* Header */}
        <div id="overview" className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4 scroll-mt-40">
          <div>
            <h1 className="text-3xl font-display font-semibold text-brand-dark mb-2">{hotel.name}</h1>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-brand-dark/60 min-w-0 break-words">{hotel.location}</p>
                <button
                  type="button"
                  onClick={() => void openDirections()}
                  disabled={isOpeningMaps}
                  title="Open location in Google Maps"
                  aria-label="Open location in Google Maps"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-brand-primary/20 bg-brand-primary/5 text-brand-primary hover:bg-brand-primary hover:text-white hover:border-brand-primary transition-colors disabled:opacity-60"
                >
                  {isOpeningMaps
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <MapPin className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span className="text-[10px] font-bold uppercase tracking-wider">Location</span>
                </button>
              </div>
              {hotel.contactNumber && (
                <a href={`tel:${hotel.contactNumber}`} className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary/5 hover:bg-brand-primary/10 rounded-full transition-colors text-sm font-bold text-brand-dark/70 hover:text-brand-primary border border-brand-primary/10">
                  <Phone className="w-3.5 h-3.5 text-brand-primary" />{hotel.contactNumber}
                </a>
              )}
              {reviews.length > 0 && (
                <div className="flex items-center gap-2">
                  <StarRating rating={avgRating} size="sm" showValue />
                  <span className="text-xs text-brand-dark/50 font-bold">({reviews.length} reviews)</span>
                </div>
              )}
            </div>
          </div>
          <a href="#rooms" className="btn-primary shrink-0 text-sm px-6 py-3 text-center">
            {anyAvailable ? 'See availability' : 'No rooms for your dates'}
          </a>
        </div>

        {/* Section anchors */}
        <nav aria-label="Hotel sections" className="flex gap-1 overflow-x-auto border-b border-brand-primary/15 mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}
              className="shrink-0 px-3 py-2.5 text-sm font-bold text-brand-dark/70 hover:text-brand-primary border-b-2 border-transparent hover:border-brand-primary">
              {section.label}
            </a>
          ))}
        </nav>

        {/* Gallery */}
        <div className="mb-8">
          <ImageGallery
            images={allImages}
            hotelName={hotel.name}
            rating={avgRating}
            reviewCount={reviews.length}
          />
        </div>

        <div className="space-y-8">
          {/* Rooms & Rates */}
          <section id="rooms" className={sectionCard} aria-busy={isRefreshing}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h2 className="text-xl font-serif font-bold text-brand-dark">Rooms & Rates</h2>
              {isRefreshing && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-brand-dark/50">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Updating prices…
                </span>
              )}
            </div>
            <RoomsAndRates categories={categories} stay={stay} onReserve={handleReserve} />
          </section>

          {/* Facilities */}
          <section id="facilities" className={sectionCard}>
            <h2 className="text-xl font-serif font-bold text-brand-dark mb-4">Facilities</h2>
            {allAmenities.length === 0 ? (
              <p className="text-sm font-bold text-brand-dark/60">The hotel hasn't listed its facilities yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {allAmenities.map(amenity => {
                  const Icon = AMENITY_ICONS[String(amenity).toLowerCase()] ?? Wifi;
                  return (
                    <div key={String(amenity)} className="flex items-center gap-2 text-sm font-bold text-brand-dark/70">
                      <Icon className="w-4 h-4 text-brand-primary" />
                      <span className="capitalize">{String(amenity).replace(/-/g, ' ')}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* House Rules */}
          <section id="house-rules" className={sectionCard}>
            <h2 className="text-xl font-serif font-bold text-brand-dark mb-4">House Rules</h2>
            <dl className="divide-y divide-brand-primary/10 text-sm">
              <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 py-3">
                <dt className="flex items-center gap-2 sm:w-40 shrink-0 font-bold text-brand-dark"><Clock className="w-4 h-4 text-brand-primary" aria-hidden />Check-in / out</dt>
                <dd className="text-brand-dark/70 font-bold">Check-in from 2:00 PM · Check-out until 11:00 AM · Hourly rooms: from your arrival time, in blocks</dd>
              </div>
              <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 py-3">
                <dt className="flex items-center gap-2 sm:w-40 shrink-0 font-bold text-brand-dark"><IdCard className="w-4 h-4 text-brand-primary" aria-hidden />Valid ID</dt>
                <dd className="text-brand-dark/70 font-bold">A valid government ID is required when you book and at check-in.</dd>
              </div>
              <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 py-3">
                <dt className="flex items-center gap-2 sm:w-40 shrink-0 font-bold text-brand-dark"><Wallet className="w-4 h-4 text-brand-primary" aria-hidden />Payment</dt>
                <dd className="text-brand-dark/70 font-bold">You pay the full stay when you book, by scanning the hotel's GCash or Maya QR. The hotel checks your payment and confirms your stay.</dd>
              </div>
              <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 py-3">
                <dt className="flex items-center gap-2 sm:w-40 shrink-0 font-bold text-brand-dark"><Wallet className="w-4 h-4 text-brand-primary" aria-hidden />Cancellation</dt>
                <dd className="text-brand-danger font-bold">Non-refundable. Payments can't be refunded if you cancel, change dates or don't arrive.</dd>
              </div>
            </dl>
          </section>

          {/* Reviews */}
          <section id="reviews" className={sectionCard}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-serif font-bold text-brand-dark">Guest Reviews</h2>
              {reviews.length > 0 && (
                <div className="flex items-center gap-2 bg-brand-primary text-white px-3 py-1.5 rounded-xl">
                  <Star className="w-4 h-4 fill-white" />
                  <span className="font-bold text-sm">{avgRating.toFixed(1)}</span>
                  <span className="text-xs text-white/70">({reviews.length})</span>
                </div>
              )}
            </div>
            {reviews.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-brand-primary/10 rounded-xl bg-brand-background/50">
                <div className="w-16 h-16 bg-brand-surface rounded-full flex items-center justify-center mb-4 shadow-sm border border-brand-primary/10">
                  <MessageSquareQuote className="w-8 h-8 text-brand-secondary" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-serif font-bold text-brand-dark mb-2">No reviews yet</h3>
                <p className="text-sm font-bold text-brand-dark/60 max-w-sm mb-6">
                  Reviews come only from guests who completed a stay here.
                </p>
                <a href="#rooms" className="btn-outline">See rooms</a>
              </div>
            ) : (
              <div className="space-y-4">
                {reviews.map(review => (
                  <div key={review.id} className="border-b border-brand-primary/10 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sm text-brand-dark">{review.authorName}</span>
                      <StarRating rating={review.rating} size="sm" />
                    </div>
                    <p className="text-sm font-bold text-brand-dark/70">{review.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
