import { useEffect, useRef, useState, useTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, ArrowRight, ChevronLeft, ChevronRight, Clock, Star, TrendingUp, ShieldCheck, CreditCard, MessageSquareQuote } from 'lucide-react';
import Hero from '../components/home/Hero';
import AppMembershipBanner from '../components/home/AppMembershipBanner';
import { HomeSectionsSkeleton } from '../components/ui/Skeleton';
import { peekCache, cacheKey } from '../lib/queryCache';
import { searchHotels, fetchDestinations, fetchFeaturedPromo, fetchHotels, type Destination, type FeaturedPromo, type SearchResultHotel } from '../services/api';
import { formatHotelLocation, hotelCardImageSrc, NO_PHOTO_SRC, showNoPhoto } from '../lib/hotelImage';
import {
  pruneRecentlyViewed,
  readRecentlyViewed,
  type RecentlyViewedHotel,
} from '../lib/recentlyViewed';
import { withStay } from '../lib/stayParams';

const DESTINATION_IMAGES: Record<string, string> = {
  'boracay': '/images/boracay.png',
  'palawan': '/images/palawan.png',
  'siargao': '/images/siargao.png',
  'bohol': '/images/bohol.png',
};

function getDestinationImage(name: string) {
  return DESTINATION_IMAGES[name.toLowerCase()] || '/hero/slide-1.png';
}

interface RecentlyViewedItem extends RecentlyViewedHotel {}

export function DestinationCard({ dest, onClick }: { dest: Destination; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-[4/3] rounded-2xl overflow-hidden group shadow-md cursor-pointer w-full text-left"
    >
      <img src={getDestinationImage(dest.name)} alt={dest.name}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover"
        onError={(e) => { (e.target as HTMLImageElement).src = '/hero/slide-1.png'; }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/80 via-brand-dark/20 to-transparent" />
      <div className="absolute bottom-4 left-4 text-left">
        <p className="text-brand-cream font-serif font-bold text-xl">{dest.name}</p>
        <p className="text-brand-cream/75 text-xs font-bold">{dest.count} {dest.count === 1 ? 'property' : 'properties'}</p>
      </div>
    </button>
  );
}

function FeaturedHotelCard({ hotel, priority = false }: { hotel: SearchResultHotel; priority?: boolean }) {
  const navigate = useNavigate();
  const locationLabel = formatHotelLocation(hotel.location, hotel.city);

  // All photos of the hotel/rooms for the swipeable slideshow (deduped, capped).
  const slides = [...new Set([hotel.imageUrl, ...(hotel.images ?? [])].filter(Boolean) as string[])]
    .map((src) => hotelCardImageSrc(src) ?? src)
    .slice(0, 6);
  if (slides.length === 0) slides.push(NO_PHOTO_SRC);

  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);

  // Slow auto-slideshow; pauses while the guest interacts or prefers reduced motion.
  useEffect(() => {
    if (paused || slides.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setSlide((s) => (s + 1) % slides.length), 4500);
    return () => window.clearInterval(id);
  }, [paused, slides.length]);

  const goTo = (index: number) => setSlide(((index % slides.length) + slides.length) % slides.length);
  const hasPromo = Boolean(hotel.hasPromo && hotel.promoPrice && hotel.promoPrice > 0);
  const startsFrom = hasPromo ? hotel.promoPrice! : hotel.minPrice;

  return (
    <div
      className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm overflow-hidden cursor-pointer w-full sm:max-w-none sm:mx-0 hover:shadow-md transition-shadow"
      onClick={() => navigate(withStay(`/hotels/${hotel.id}`))}
    >
      <div
        className="relative aspect-[4/3] bg-gradient-to-br from-brand-primary/10 to-brand-secondary/10 overflow-hidden touch-pan-y"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={(e) => { setPaused(true); touchX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          setPaused(false);
          if (start == null || slides.length < 2) return;
          const dx = (e.changedTouches[0]?.clientX ?? start) - start;
          if (Math.abs(dx) > 40) goTo(slide + (dx < 0 ? 1 : -1));
        }}
      >
        {slides.map((src, i) => (
          <img
            key={`${src}-${i}`}
            src={src}
            alt={i === slide ? hotel.name : ''}
            aria-hidden={i !== slide}
            loading={priority && i === 0 ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority && i === 0 ? 'high' : 'auto'}
            className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${i === slide ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onError={showNoPhoto}
            draggable={false}
          />
        ))}
        {hasPromo && (
          <span className="absolute top-3 left-3 bg-brand-danger text-white text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg shadow-md">
            Promo
          </span>
        )}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-brand-dark/80 text-white text-sm font-bold px-2.5 py-1.5 rounded-lg shadow-md">
          <Star className="w-3.5 h-3.5 fill-brand-star text-brand-star shrink-0" />
          {hotel.avgRating > 0 ? hotel.avgRating.toFixed(1) : 'New'}
          {hotel.totalReviews > 0 && (
            <span className="text-[10px] font-bold text-white/70">({hotel.totalReviews})</span>
          )}
        </div>
        {slides.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); goTo(slide - 1); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-brand-dark/60 text-white hidden sm:flex items-center justify-center hover:bg-brand-dark/80"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => { e.stopPropagation(); goTo(slide + 1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-brand-dark/60 text-white hidden sm:flex items-center justify-center hover:bg-brand-dark/80"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="absolute bottom-3 right-3 flex gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Photo ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); goTo(i); }}
                  className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-5 bg-white' : 'w-1.5 bg-white/60'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <div className="p-4 sm:p-5">
        <h3 className="font-serif font-extrabold text-lg text-brand-dark mb-1 line-clamp-1">{hotel.name}</h3>
        <p className="flex items-center gap-1.5 text-xs font-bold text-brand-dark/50 mb-3 min-w-0">
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate" title={hotel.location}>{locationLabel}</span>
        </p>
        {/* Price: big promo "starts from" when the hotel turned promo on, else regular starts-from. */}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-[10px] font-bold uppercase tracking-widest ${hasPromo ? 'text-brand-danger' : 'text-brand-dark/45'}`}>
              {hasPromo ? 'Promo · Starts from' : 'Starts from'}
            </p>
            <p className={`font-bold text-brand-dark tabular-nums leading-none ${hasPromo ? 'text-3xl' : 'text-2xl'}`}>
              <span className="text-sm align-top pr-0.5">₱</span>{(startsFrom ?? 0).toLocaleString()}
              <span className="text-xs font-bold text-brand-dark/50"> /night</span>
            </p>
            {hasPromo && hotel.promoRegularPrice && hotel.promoRegularPrice > (hotel.promoPrice ?? 0) && (
              <p className="mt-1 text-xs font-bold text-brand-dark/45 tabular-nums">
                Regular <span className="line-through">₱{hotel.promoRegularPrice.toLocaleString()}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigate(withStay(`/hotels/${hotel.id}`)); }}
            className="text-xs font-bold text-brand-primary hover:text-brand-hover flex items-center gap-1 transition-colors shrink-0"
          >
            View rooms <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [, startTransition] = useTransition();

  const cachedHome = peekCache<{ data: SearchResultHotel[]; total: number }>(
    cacheKey(['searchHotels', { limit: 4 }]),
  );
  const cachedDestinations = peekCache<Destination[]>('destinations');
  const cachedPromo = peekCache<FeaturedPromo | null>('featured-promo');

  const [hotels, setHotels] = useState<SearchResultHotel[]>(cachedHome?.data ?? []);
  const [hotelTotal, setHotelTotal] = useState(cachedHome?.total ?? 0);
  const [destinations, setDestinations] = useState<Destination[]>(cachedDestinations ?? []);
  const [featuredPromo, setFeaturedPromo] = useState<FeaturedPromo | null>(
    cachedPromo === undefined ? null : cachedPromo,
  );
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedItem[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(!cachedHome && !cachedDestinations);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      searchHotels({ limit: 4 }).then((res) => {
        if (cancelled) return;
        startTransition(() => {
          setHotels(res.data);
          setHotelTotal(res.total);
        });
      }).catch(() => {
        if (!cancelled && !cachedHome) {
          setHotels([]);
          setHotelTotal(0);
        }
      }),
      fetchDestinations().then((list) => {
        if (!cancelled) startTransition(() => setDestinations(list));
      }).catch(() => {
        if (!cancelled && !cachedDestinations) setDestinations([]);
      }),
      fetchFeaturedPromo().then((promo) => {
        if (!cancelled) startTransition(() => setFeaturedPromo(promo));
      }).catch(() => undefined),
    ]).finally(() => {
      if (!cancelled) setIsBootstrapping(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Load recently viewed, then drop hotels that no longer exist on the API
  // (old Gloreto / Datest IDs from before the Mongo switch).
  useEffect(() => {
    setRecentlyViewed(readRecentlyViewed());
    let cancelled = false;
    void fetchHotels()
      .then((list) => {
        if (cancelled) return;
        setRecentlyViewed(pruneRecentlyViewed(list));
      })
      .catch(() => {
        // Keep cached history if the hotels list request fails.
      });
    return () => { cancelled = true; };
  }, []);

  const featuredHotels = hotels.slice(0, 4);

  useEffect(() => {
    if (featuredHotels.length === 0) return;
    const src = hotelCardImageSrc(featuredHotels[0].imageUrl || featuredHotels[0].images?.[0]);
    if (!src) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = src;
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, [featuredHotels]);

  return (
    <div className="w-full">
      <Hero initialDestination="" />

      {isBootstrapping ? (
        <HomeSectionsSkeleton />
      ) : (
      <div className="page-shell py-12 sm:py-16 space-y-12 sm:space-y-16">

        {/* Featured Destinations */}
        {destinations.length > 0 && (
          <section>
            <div className="flex items-end justify-between gap-4 mb-6">
              <div>
                <p className="section-eyebrow">Explore Philippines</p>
                <h2 className="section-title">Featured Destinations</h2>
              </div>
              <button type="button" onClick={() => navigate(withStay('/search'))}
                className="text-sm font-bold text-brand-primary hover:text-brand-hover flex items-center gap-1.5 transition-colors shrink-0">
                View all <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            {/* Same card width as Featured Properties on mobile (full row), then 2-up / 4-up. */}
            <div className="grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {destinations.map(dest => (
                <DestinationCard
                  key={dest.name}
                  dest={dest}
                  onClick={() => navigate(withStay(`/search?destination=${encodeURIComponent(dest.query)}`))}
                />
              ))}
            </div>
          </section>
        )}

        {/* Featured Properties */}
        {featuredHotels.length > 0 && (
          <section>
            <div className="flex items-end justify-between gap-4 mb-6">
              <div>
                <p className="section-eyebrow">Handpicked for you</p>
                <h2 className="section-title">Featured Properties</h2>
              </div>
              <button type="button" onClick={() => navigate(withStay('/search'))}
                className="text-sm font-bold text-brand-primary hover:text-brand-hover flex items-center gap-1.5 transition-colors shrink-0">
                All properties <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 justify-items-stretch">
              {featuredHotels.map((hotel, index) => (
                <FeaturedHotelCard key={hotel.id} hotel={hotel} priority={index === 0} />
              ))}
            </div>
          </section>
        )}

        {/* Popular Deals Banner */}
        {featuredPromo && (
          <section className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-brand-dark to-brand-primary p-8 md:p-12">
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <div className="flex items-center gap-2 mb-2 justify-center md:justify-start">
                  <TrendingUp className="w-5 h-5 text-brand-cream/80" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-cream/70">Limited time offers</p>
                </div>
                <h2 className="text-3xl md:text-4xl font-serif font-bold text-brand-cream mb-3">Popular Deals</h2>
                <p className="text-brand-cream/70 font-bold text-sm max-w-md">
                  {featuredPromo.description} Use code <span className="text-brand-cream font-bold bg-white/10 px-2 py-0.5 rounded-lg">{featuredPromo.code}</span> at checkout.
                </p>
              </div>
              <button type="button" onClick={() => navigate(withStay('/search?sort=price'))}
                className="shrink-0 px-8 py-4 bg-brand-cream text-brand-dark font-bold text-sm rounded-xl hover:bg-brand-cream/90 transition-all active:scale-95 shadow-lg">
                Browse Deals <ArrowRight className="inline w-4 h-4 ml-1" />
              </button>
            </div>
          </section>
        )}

        {/* Recently Viewed */}
        {recentlyViewed.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <Clock className="w-5 h-5 text-brand-primary" />
              <h2 className="section-title">Recently Viewed</h2>
            </div>
            <div className="flex gap-6 overflow-x-auto pb-4 pt-2 -mx-4 px-4 sm:mx-0 sm:px-0">
              {recentlyViewed.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(withStay(`/hotels/${item.id}`))}
                  className="shrink-0 bg-brand-surface rounded-2xl border border-brand-primary/10 shadow-luxury p-5 text-left w-[240px] hover:border-brand-primary/30 hover:shadow-luxury-hover transition-colors"
                >
                  <div className="h-32 mb-4 rounded-xl bg-brand-background overflow-hidden relative">
                    <img src={item.imageUrl || NO_PHOTO_SRC} alt={item.name} loading="lazy" decoding="async" className="w-full h-full object-cover" onError={showNoPhoto} />
                  </div>
                  <p className="font-serif font-bold text-lg text-brand-dark line-clamp-1">{item.name}</p>
                  <p className="flex items-center gap-1.5 text-xs font-bold text-brand-dark/50 mt-1.5 min-w-0">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate" title={item.location}>
                      {formatHotelLocation(item.location) || item.location}
                    </span>
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Trust Indicators */}
        <section className="fluid-card-grid">
          {[
            { icon: <ShieldCheck className="w-8 h-8 text-brand-primary" strokeWidth={1.5} />, title: 'Secure Booking', desc: 'Your details travel over an encrypted (HTTPS) connection and go only to the hotel you book.' },
            { icon: <CreditCard className="w-8 h-8 text-brand-primary" strokeWidth={1.5} />, title: 'Pay with E-Wallets', desc: 'Pay by scanning the hotel’s own GCash or Maya QR when you book, then upload your receipt.' },
            { icon: <MessageSquareQuote className="w-8 h-8 text-brand-primary" strokeWidth={1.5} />, title: 'Verified Reviews', desc: 'Only guests who completed a stay can leave a review — one per stay.' },
          ].map(item => (
            <div key={item.title} className="bg-brand-surface rounded-2xl border border-brand-primary/10 shadow-luxury p-8 flex flex-col items-start hover:shadow-luxury-hover transition-shadow">
              <div className="mb-5 p-3 rounded-2xl bg-brand-primary/8 text-brand-primary">
                {item.icon}
              </div>
              <h3 className="font-serif font-bold text-xl text-brand-dark mb-2">{item.title}</h3>
              <p className="text-sm text-brand-dark/60 font-medium leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </section>

        <AppMembershipBanner />
      </div>
      )}

      {/* About Footer */}
      <section className="relative bg-brand-dark py-16 sm:py-20 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        <div className="page-shell relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-brand-gold font-bold text-xs uppercase tracking-[0.2em] mb-4">The Madyaw Standard</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-semibold text-brand-cream mb-6 leading-tight">Elevating Island Hospitality</h2>
            <p className="text-brand-cream/80 font-sans font-medium leading-relaxed text-base sm:text-lg">
              <strong className="text-brand-gold">Madyaw</strong> is a curated collection of places to stay across the Philippines, connecting guests with unique homes, stays, and local experiences.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 min-[480px]:grid-cols-3 gap-6 border-t border-brand-gold/25 pt-10">
            <div className="text-center">
              <p className="text-3xl font-display font-semibold text-brand-gold">{hotelTotal || featuredHotels.length || '—'}</p>
              <p className="mt-1 text-xs font-bold text-brand-cream/60 uppercase tracking-widest">Partner stays</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-display font-semibold text-brand-gold">{destinations.length || '—'}</p>
              <p className="mt-1 text-xs font-bold text-brand-cream/60 uppercase tracking-widest">
                {destinations.length === 1 ? 'Destination' : 'Destinations'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-display font-semibold text-brand-gold">Web</p>
              <p className="mt-1 text-xs font-bold text-brand-cream/60 uppercase tracking-widest">Request to book</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
