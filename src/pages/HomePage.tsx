import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { MapPin, ArrowRight, Clock, Star, TrendingUp, ShieldCheck, CreditCard, MessageSquareQuote } from 'lucide-react';
import Hero from '../components/home/Hero';
import AppMembershipBanner from '../components/home/AppMembershipBanner';
import { searchHotels, fetchDestinations, fetchFeaturedPromo, type Destination, type FeaturedPromo, type SearchResultHotel } from '../services/api';

const DESTINATION_IMAGES: Record<string, string> = {
  'boracay': '/images/boracay.png',
  'palawan': '/images/palawan.png',
  'siargao': '/images/siargao.png',
  'bohol': '/images/bohol.png',
};

function getDestinationImage(name: string) {
  return DESTINATION_IMAGES[name.toLowerCase()] || '/hero/slide-1.jpg';
}

interface RecentlyViewedItem {
  id: string;
  name: string;
  location: string;
  imageUrl?: string;
}

function DestinationCard({ dest, onClick }: { dest: Destination; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="relative h-52 rounded-2xl overflow-hidden group shadow-md cursor-pointer w-full text-left"
    >
      <img src={getDestinationImage(dest.name)} alt={dest.name}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        onError={(e) => { (e.target as HTMLImageElement).src = '/hero/slide-1.jpg'; }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/80 via-brand-dark/20 to-transparent" />
      <div className="absolute bottom-4 left-4 text-left">
        <p className="text-brand-cream font-serif font-bold text-xl">{dest.name}</p>
        <p className="text-brand-cream/75 text-xs font-bold">{dest.count} {dest.count === 1 ? 'property' : 'properties'}</p>
      </div>
    </motion.button>
  );
}

function FeaturedHotelCard({ hotel }: { hotel: SearchResultHotel }) {
  const navigate = useNavigate();
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm overflow-hidden cursor-pointer"
      onClick={() => navigate(`/hotels/${hotel.id}`)}
    >
      <div className="h-44 bg-gradient-to-br from-brand-primary/10 to-brand-secondary/10 flex items-center justify-center relative">
        {hotel.imageUrl || (hotel.images && hotel.images.length > 0) ? (
          <img src={hotel.imageUrl || hotel.images[0]} alt={hotel.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = '/hero/slide-1.jpg'; }} />
        ) : (
          <MapPin className="w-12 h-12 text-brand-primary/30" />
        )}
        <div className="absolute top-3 right-3 bg-brand-cream/90 backdrop-blur-sm px-2 py-1 rounded-lg shadow-sm">
          <p className="text-xs font-bold text-brand-dark"><span className="text-[10px] text-brand-dark/50 pr-0.5">₱</span>{hotel.minPrice?.toLocaleString() || 0}</p>
        </div>
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-brand-dark/80 backdrop-blur-sm text-white text-sm font-bold px-2.5 py-1.5 rounded-lg shadow-md">
          <Star className="w-3.5 h-3.5 fill-brand-star text-brand-star" />
          {hotel.avgRating > 0 ? hotel.avgRating.toFixed(1) : 'New'}
          {hotel.totalReviews > 0 && (
            <span className="text-[10px] font-bold text-white/70">({hotel.totalReviews})</span>
          )}
        </div>
      </div>
      <div className="p-5">
        <h3 className="font-serif font-bold text-lg text-brand-dark mb-1 line-clamp-1">{hotel.name}</h3>
        <p className="flex items-center gap-1.5 text-xs font-bold text-brand-dark/50 mb-3">
          <MapPin className="w-3.5 h-3.5" />{hotel.location}
        </p>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); navigate(`/hotels/${hotel.id}`); }}
            className="text-xs font-bold text-brand-primary hover:text-brand-hover flex items-center gap-1 transition-colors"
          >
            View rooms <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();

  const [hotels, setHotels] = useState<SearchResultHotel[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [featuredPromo, setFeaturedPromo] = useState<FeaturedPromo | null>(null);
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedItem[]>([]);

  useEffect(() => {
    searchHotels({ limit: 4 }).then(res => setHotels(res.data)).catch(() => setHotels([]));
    fetchDestinations().then(setDestinations).catch(() => setDestinations([]));
    fetchFeaturedPromo().then(setFeaturedPromo).catch(() => setFeaturedPromo(null));
  }, []);

  // Load recently viewed from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('madyaw_recently_viewed');
      if (stored) setRecentlyViewed(JSON.parse(stored) as RecentlyViewedItem[]);
    } catch {}
  }, []);

  const featuredHotels = hotels.slice(0, 4);

  return (
    <div className="w-full">
      <Hero initialDestination="" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-20">

        {/* Featured Destinations */}
        {destinations.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="section-eyebrow">Explore Philippines</p>
                <h2 className="section-title">Featured Destinations</h2>
              </div>
              <button type="button" onClick={() => navigate('/search')}
                className="text-sm font-bold text-brand-primary hover:text-brand-hover flex items-center gap-1.5 transition-colors">
                View all <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {destinations.map(dest => (
                <DestinationCard key={dest.name} dest={dest} onClick={() => navigate(`/search?destination=${encodeURIComponent(dest.query)}`)} />
              ))}
            </div>
          </section>
        )}

        {/* Featured Properties */}
        {featuredHotels.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="section-eyebrow">Handpicked for you</p>
                <h2 className="section-title">Featured Properties</h2>
              </div>
              <button type="button" onClick={() => navigate('/search')}
                className="text-sm font-bold text-brand-primary hover:text-brand-hover flex items-center gap-1.5 transition-colors">
                All properties <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {featuredHotels.map(hotel => <FeaturedHotelCard key={hotel.id} hotel={hotel} />)}
            </div>
          </section>
        )}

        <AppMembershipBanner />

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
              <button type="button" onClick={() => navigate('/search?sort=price')}
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
                <motion.button
                  key={item.id}
                  whileHover={{ y: -4 }}
                  type="button"
                  onClick={() => navigate(`/hotels/${item.id}`)}
                  className="shrink-0 bg-brand-surface rounded-2xl border border-brand-primary/10 shadow-luxury p-5 text-left w-[240px] hover:border-brand-primary/30 hover:shadow-luxury-hover transition-all"
                >
                  <div className="h-32 mb-4 rounded-xl bg-brand-background overflow-hidden relative">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).src = '/hero/slide-1.jpg'; }} />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 flex items-center justify-center">
                        <MapPin className="w-8 h-8 text-brand-primary/40" />
                      </div>
                    )}
                  </div>
                  <p className="font-serif font-bold text-lg text-brand-dark line-clamp-1">{item.name}</p>
                  <p className="flex items-center gap-1.5 text-xs font-bold text-brand-dark/50 mt-1.5">
                    <MapPin className="w-3.5 h-3.5" />{item.location}
                  </p>
                </motion.button>
              ))}
            </div>
          </section>
        )}

        {/* Trust Indicators */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: <ShieldCheck className="w-8 h-8 text-brand-primary" strokeWidth={1.5} />, title: 'Secure Booking', desc: 'Your data is protected with bank-grade encryption.' },
            { icon: <CreditCard className="w-8 h-8 text-brand-primary" strokeWidth={1.5} />, title: 'Multiple Payment Options', desc: 'GCash, Maya, credit/debit cards, and bank transfer.' },
            { icon: <MessageSquareQuote className="w-8 h-8 text-brand-primary" strokeWidth={1.5} />, title: 'Verified Reviews', desc: 'All reviews are from verified, completed stays.' },
          ].map(item => (
            <div key={item.title} className="bg-brand-surface rounded-2xl border border-brand-primary/10 shadow-luxury p-8 flex flex-col items-start hover:shadow-luxury-hover transition-shadow">
              <div className="mb-5 p-3 rounded-2xl bg-brand-gold/15 text-brand-primary">
                {item.icon}
              </div>
              <h3 className="font-serif font-bold text-xl text-brand-dark mb-2">{item.title}</h3>
              <p className="text-sm text-brand-dark/60 font-medium leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </section>
      </div>

      {/* About Footer */}
      <section className="relative bg-brand-dark py-24 overflow-hidden">
        {/* Subtle background texture */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        <div className="max-w-4xl mx-auto px-4 text-center relative z-10">
          <p className="text-brand-gold font-bold text-xs uppercase tracking-[0.2em] mb-4">The Madyaw Standard</p>
          <h2 className="text-3xl md:text-5xl font-display font-semibold text-brand-cream mb-8 leading-tight">Elevating Island Hospitality</h2>
          <p className="text-brand-cream/80 font-sans font-medium leading-relaxed text-lg mb-16 max-w-2xl mx-auto">
            <strong className="text-brand-gold">Madyaw</strong> is a curated collection of places to stay across the Philippines, connecting guests with unique homes, stays, and local experiences.
          </p>
          
          <div className="border-t border-brand-gold/25 pt-12">
            <p className="text-3xl font-display font-semibold text-brand-gold mb-1">100%</p>
            <p className="text-xs font-bold text-brand-cream/60 uppercase tracking-widest">Curated Stays</p>
          </div>
        </div>
      </section>
    </div>
  );
}
