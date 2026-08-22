import { useEffect, useState } from 'react';
import { useScroll } from '../hooks/useScroll';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, MapPin, Phone, Star, ChevronLeft, ChevronRight, X, Wifi, Waves, Utensils, Dumbbell, ParkingCircle, Wind, Coffee, Tv, ShieldCheck, Calendar, Users, MessageSquareQuote } from 'lucide-react';
import { fetchHotelDetailById } from '../api/propertyService';
import { fetchReviews, type Review } from '../services/api';
import type { Hotel } from '../types';
import type { HotelDetailCategory } from '../services/api';
import { useToast } from '../components/ui/ToastProvider';
import StarRating from '../components/ui/StarRating';
import { format, addDays } from 'date-fns';
import { buildGoogleMapsDirectionsUrl, getCurrentPosition, resolveHotelMapsDestination } from '../lib/nearMe';

// Track recently viewed in localStorage
function trackRecentlyViewed(hotel: Hotel) {
  try {
    const stored = localStorage.getItem('madyaw_recently_viewed');
    const list: Array<{ id: string; name: string; location: string; imageUrl?: string }> = stored ? JSON.parse(stored) : [];
    const filtered = list.filter(i => i.id !== hotel.id);
    filtered.unshift({ id: hotel.id, name: hotel.name, location: hotel.location, imageUrl: hotel.imageUrl });
    localStorage.setItem('madyaw_recently_viewed', JSON.stringify(filtered.slice(0, 8)));
  } catch {}
}

const AMENITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  wifi: Wifi, pool: Waves, restaurant: Utensils, gym: Dumbbell,
  parking: ParkingCircle, 'air-conditioning': Wind, bar: Coffee, tv: Tv,
  'beach-access': Waves, spa: Star, kitchen: Utensils, 'airport-shuttle': MapPin,
};

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
      <div className="h-80 bg-gradient-to-br from-brand-primary/10 to-brand-secondary/10 rounded-2xl flex items-center justify-center">
        <MapPin className="w-16 h-16 text-brand-primary/20" />
      </div>
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
            <img src={images[0]} alt={hotelName} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" onError={e => { (e.target as HTMLImageElement).src = '/hero/slide-1.jpg'; }} />
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
              <img src={img} alt={`${hotelName} ${i + 2}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" onError={e => { (e.target as HTMLImageElement).src = '/hero/slide-1.jpg'; }} />
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

function StickyBookingWidget({
  onBook,
  categories,
  checkIn,
  checkOut,
  guests,
  onCheckInChange,
  onCheckOutChange,
  onGuestsChange,
}: {
  onBook: (cat: HotelDetailCategory, checkIn: string, checkOut: string, guests: number) => void;
  categories: HotelDetailCategory[];
  checkIn: string;
  checkOut: string;
  guests: number;
  onCheckInChange: (value: string) => void;
  onCheckOutChange: (value: string) => void;
  onGuestsChange: (value: number) => void;
}) {
  const scrolled = useScroll(20);
  const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));
  const lowestCat = categories.filter(c => c.availableRooms > 0).sort((a, b) => a.defaultPrice - b.defaultPrice)[0];

  return (
    <div className={`bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-lg p-6 transition-all duration-300 lg:sticky ${scrolled ? 'lg:top-6' : 'lg:top-28'}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-1">Starting from</p>
      {categories.length === 0 ? (
        <div className="mb-4">
          <p className="text-xl font-serif font-bold text-brand-dark">Contact for rates</p>
        </div>
      ) : (
        <p className="text-3xl font-serif font-bold text-brand-dark mb-4">
          ₱{lowestCat ? lowestCat.defaultPrice.toLocaleString() : '...'}<span className="text-sm font-sans text-brand-dark/50">/night</span>
        </p>
      )}

      <div className="space-y-3 mb-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 block mb-1">Check-in</label>
          <div className="flex items-center gap-2 border border-brand-primary/20 rounded-xl px-3 py-2">
            <Calendar className="w-4 h-4 text-brand-primary/60" />
            <input type="date" value={checkIn} min={format(new Date(), 'yyyy-MM-dd')}
              onChange={e => {
                onCheckInChange(e.target.value);
                if (e.target.value >= checkOut) onCheckOutChange(format(addDays(new Date(e.target.value), 1), 'yyyy-MM-dd'));
              }}
              className="bg-transparent text-sm text-brand-dark font-bold outline-none flex-1" />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 block mb-1">Check-out</label>
          <div className="flex items-center gap-2 border border-brand-primary/20 rounded-xl px-3 py-2">
            <Calendar className="w-4 h-4 text-brand-primary/60" />
            <input type="date" value={checkOut} min={checkIn ? format(addDays(new Date(checkIn), 1), 'yyyy-MM-dd') : undefined}
              onChange={e => onCheckOutChange(e.target.value)}
              className="bg-transparent text-sm text-brand-dark font-bold outline-none flex-1" />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 block mb-1">Guests</label>
          <div className="flex items-center gap-2 border border-brand-primary/20 rounded-xl px-3 py-2">
            <Users className="w-4 h-4 text-brand-primary/60" />
            <select value={guests} onChange={e => onGuestsChange(Number(e.target.value))} className="bg-transparent text-sm text-brand-dark font-bold outline-none flex-1">
              {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} Guest{n !== 1 ? 's' : ''}</option>)}
            </select>
          </div>
        </div>
      </div>

      {lowestCat && (
        <p className="text-center text-sm font-bold text-brand-dark/60 mb-4">
          {nights} night{nights !== 1 ? 's' : ''} · Est. <span className="text-brand-primary">₱{(lowestCat.defaultPrice * nights).toLocaleString()}</span>
        </p>
      )}

      <button type="button" disabled={!lowestCat}
        onClick={() => lowestCat && onBook(lowestCat, checkIn, checkOut, guests)}
        className="w-full btn-primary py-4 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
        {lowestCat ? 'Reserve Now' : 'No rooms available'}
      </button>
      <p className="text-center text-[10px] text-brand-dark/40 font-bold mt-3 flex items-center justify-center gap-1">
        <ShieldCheck className="w-3.5 h-3.5" /> No hidden fees
      </p>
    </div>
  );
}

export default function HotelDetailPage() {
  const { hotelId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [categories, setCategories] = useState<HotelDetailCategory[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpeningMaps, setIsOpeningMaps] = useState(false);
  const [bookCheckIn, setBookCheckIn] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [bookCheckOut, setBookCheckOut] = useState(format(addDays(new Date(), 3), 'yyyy-MM-dd'));
  const [bookGuests, setBookGuests] = useState(2);

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
      setIsLoading(true);
      setError(null);
      try {
        const [hotelDetail, reviewData] = await Promise.all([
          fetchHotelDetailById(hotelId),
          fetchReviews({ hotelId }).catch(() => ({ data: [], total: 0, totalPages: 0 })),
        ]);
        if (!isActive) return;
        setHotel(hotelDetail.hotel);
        setCategories(hotelDetail.categories);
        setReviews(reviewData.data);
        trackRecentlyViewed(hotelDetail.hotel);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Unable to load hotel data');
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    void load();
    return () => { isActive = false; };
  }, [hotelId]);

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

  const handleBook = (cat: HotelDetailCategory, checkIn: string, checkOut: string, guests: number) => {
    const candidateId = cat.firstAvailableRoomId ?? cat.fallbackRoomId;
    if (!candidateId) {
      showToast({ title: 'No rooms available', description: 'No rooms found for this category.', type: 'info' });
      return;
    }
    navigate(`/booking/${candidateId}?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen pt-32 bg-brand-background flex items-center justify-center">
        <div className="bg-brand-cream p-8 rounded-2xl shadow-md border border-brand-primary/10 text-center">
          <Loader2 className="w-8 h-8 text-brand-primary animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-serif font-bold text-brand-dark">Loading hotel…</h2>
        </div>
      </div>
    );
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

  const allAmenities = Array.from(new Set(categories.flatMap(c => (c as any).amenities ?? [])));

  return (
    <div className="bg-brand-background min-h-screen pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-display font-semibold text-brand-dark mb-2">{hotel.name}</h1>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-brand-dark/60">{hotel.location}</p>
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
          <div className="flex items-center shrink-0">
            {categories.some(c => c.availableRooms > 0) ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-success/10 text-brand-success border border-brand-success/25 px-4 py-2 text-sm font-bold tracking-wide">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-success animate-pulse" aria-hidden />
                Rooms available
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-danger/10 text-brand-danger border border-brand-danger/25 px-4 py-2 text-sm font-bold tracking-wide">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-danger" aria-hidden />
                Fully booked
              </span>
            )}
          </div>
        </div>

        {/* Gallery */}
        <div className="mb-8">
          <ImageGallery
            images={allImages}
            hotelName={hotel.name}
            rating={avgRating}
            reviewCount={reviews.length}
          />
        </div>

        {/* Main content + Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
          <div className="space-y-8 order-2 lg:order-none">

            {/* Amenities */}
            {allAmenities.length > 0 && (
              <section className="bg-brand-cream rounded-2xl p-6 border border-brand-primary/10">
                <h2 className="text-xl font-serif font-bold text-brand-dark mb-4">Amenities</h2>
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
              </section>
            )}

            {/* Room Categories */}
            <section className="bg-brand-cream rounded-2xl p-6 border border-brand-primary/10">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-xl font-serif font-bold text-brand-dark">Available Rooms</h2>
                {categories.some(c => c.availableRooms > 0) && (
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-success/10 text-brand-success border border-brand-success/25 px-3.5 py-1.5 text-xs font-bold tracking-wide">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-success" aria-hidden />
                    Rooms available
                  </span>
                )}
              </div>
              <div className="space-y-4">
                {categories.length === 0 ? (
                  <p className="text-sm font-bold text-brand-dark/60">No room categories available.</p>
                ) : (
                  categories.map(cat => (
                    <div key={cat.id} className="border border-brand-primary/10 rounded-xl overflow-hidden">
                      <div className="flex flex-col md:flex-row">
                        {cat.imageUrl && (
                          <div className="md:w-48 h-40 md:h-auto shrink-0">
                            <img src={cat.imageUrl} alt={cat.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).src = '/hero/slide-1.jpg'; }} />
                          </div>
                        )}
                        <div className="flex-1 p-5 flex flex-col md:flex-row justify-between gap-4">
                          <div className="flex-1">
                            <h3 className="font-serif font-bold text-lg text-brand-dark mb-1">{cat.name}</h3>
                            {cat.description && <p className="text-sm text-brand-dark/60 mb-3 line-clamp-2">{cat.description}</p>}
                            <div className="flex flex-wrap gap-2 mb-3">
                              {cat.availableRooms > 0
                                ? (
                                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-success/10 text-brand-success border border-brand-success/25 text-xs font-bold px-3 py-1.5 tracking-wide">
                                    Available
                                  </span>
                                )
                                : <span className="inline-flex items-center rounded-full bg-brand-danger/10 text-brand-danger border border-brand-danger/25 text-xs font-bold px-3 py-1.5 tracking-wide">Fully booked</span>
                              }
                              {(cat as any).freeCancellation && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-brand-success/10 text-brand-success">Free cancellation</span>}
                              {(cat as any).breakfastIncluded && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-brand-warning/10 text-brand-warning">🍳 Breakfast included</span>}
                            </div>
                            <p className="text-xs font-bold text-brand-dark/50">{cat.totalRooms} total rooms in category</p>
                          </div>
                          <div className="flex flex-col items-end justify-between gap-3 min-w-[140px]">
                            <div className="text-right">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/40">Per night</p>
                              <p className="text-2xl font-serif font-bold text-brand-primary">₱{cat.defaultPrice.toLocaleString()}</p>
                            </div>
                            <button
                              type="button"
                              disabled={cat.availableRooms === 0}
                              onClick={() => handleBook(cat, bookCheckIn, bookCheckOut, bookGuests)}
                              className="btn-primary text-xs w-full disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {cat.availableRooms > 0 ? `Reserve ${cat.name}` : 'Unavailable'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>


            {/* Reviews */}
            <section className="bg-brand-cream rounded-2xl p-6 border border-brand-primary/10">
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
                  <h3 className="text-lg font-serif font-bold text-brand-dark mb-2">Be the first to review</h3>
                  <p className="text-sm font-bold text-brand-dark/60 max-w-sm mb-6">
                    This property doesn't have any reviews yet. Book a stay and share your experience with the Madyaw community.
                  </p>
                  <button type="button" onClick={() => {
                    const el = document.querySelector('.sticky');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }} className="btn-outline">
                    Book a stay
                  </button>
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

          {/* Sticky Sidebar */}
          <aside className="order-1 lg:order-none">
            <StickyBookingWidget
              categories={categories}
              onBook={handleBook}
              checkIn={bookCheckIn}
              checkOut={bookCheckOut}
              guests={bookGuests}
              onCheckInChange={setBookCheckIn}
              onCheckOutChange={setBookCheckOut}
              onGuestsChange={setBookGuests}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
