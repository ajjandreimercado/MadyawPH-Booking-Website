import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Calendar, Users, Search as SearchIcon, ChevronDown, Plus, Minus, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { trackSearchSubmitted } from '../../lib/analytics';
import { sanitize } from '../../utils/sanitize';
import { getCurrentPosition, isNearMeQuery } from '../../lib/nearMe';
import { useToast } from '../ui/ToastProvider';

interface HeroProps {
  initialDestination?: string;
  onSearch?: (destination: string) => void;
}

interface HeroSlide {
  src: string;
  alt: string;
}

const HERO_SLIDES: HeroSlide[] = [
  { src: 'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&q=80&w=2000', alt: 'Beautiful beach house at sunset' },
  { src: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&q=80&w=2000', alt: 'Luxury resort with infinity pool' },
  { src: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&q=80&w=2000', alt: 'Tropical villa interior' },
];

export default function Hero({ initialDestination = '' }: HeroProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [destination, setDestination] = useState<string>(initialDestination);
  const [checkIn, setCheckIn] = useState<string>(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [checkOut, setCheckOut] = useState<string>(format(addDays(new Date(), 3), 'yyyy-MM-dd'));
  const [adults, setAdults] = useState<number>(2);
  const [children, setChildren] = useState<number>(0);
  const [rooms, setRooms] = useState<number>(1);
  const [showGuestPanel, setShowGuestPanel] = useState(false);
  const [activeSlide, setActiveSlide] = useState<number>(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);
  const [isLocating, setIsLocating] = useState(false);
  const guestPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    setDestination(initialDestination);
  }, [initialDestination]);

  useEffect(() => {
    HERO_SLIDES.forEach(slide => { const img = new Image(); img.src = slide.src; });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setActiveSlide(c => (c + 1) % HERO_SLIDES.length), 5000);
    return () => window.clearInterval(id);
  }, []);

  // Close guest panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (guestPanelRef.current && !guestPanelRef.current.contains(e.target as Node)) {
        setShowGuestPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = async () => {
    const safeDestination = sanitize(destination);
    const params = new URLSearchParams();
    if (checkIn) params.set('checkIn', checkIn);
    if (checkOut) params.set('checkOut', checkOut);
    params.set('guests', String(adults + children));
    params.set('rooms', String(rooms));

    if (isNearMeQuery(safeDestination)) {
      setIsLocating(true);
      try {
        const position = await getCurrentPosition();
        params.set('near', '1');
        params.set('lat', String(position.coords.latitude));
        params.set('lng', String(position.coords.longitude));
        params.set('sort', 'distance');
        trackSearchSubmitted({ destination: 'Near me', guests: adults + children, rooms });
        navigate(`/search?${params.toString()}`);
      } catch {
        showToast({
          title: 'Location needed',
          description: 'Allow location access to find hotels near you, or type a city name.',
          type: 'error',
        });
      } finally {
        setIsLocating(false);
      }
      return;
    }

    trackSearchSubmitted({ destination: safeDestination || 'All destinations', guests: adults + children, rooms });
    if (safeDestination) params.set('destination', safeDestination);
    navigate(`/search?${params.toString()}`);
  };

  const guestLabel = `${adults} Adult${adults !== 1 ? 's' : ''}${children > 0 ? `, ${children} Child${children !== 1 ? 'ren' : ''}` : ''} · ${rooms} Room${rooms !== 1 ? 's' : ''}`;

  const Stepper = ({ label, value, onInc, onDec, min = 0 }: { label: string; value: number; onInc: () => void; onDec: () => void; min?: number }) => (
    <div className="flex items-center justify-between py-3 border-b border-brand-primary/10 last:border-0">
      <div>
        <p className="text-sm font-bold text-brand-dark">{label}</p>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onDec} disabled={value <= min}
          className="w-8 h-8 rounded-full border border-brand-primary/30 flex items-center justify-center hover:border-brand-primary disabled:opacity-40 transition-colors">
          <Minus className="w-3.5 h-3.5 text-brand-primary" />
        </button>
        <span className="text-sm font-bold text-brand-dark w-5 text-center">{value}</span>
        <button type="button" onClick={onInc}
          className="w-8 h-8 rounded-full border border-brand-primary/30 flex items-center justify-center hover:border-brand-primary transition-colors">
          <Plus className="w-3.5 h-3.5 text-brand-primary" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative h-[82vh] min-h-[620px] flex items-center justify-center pt-16">
      {/* Background Slider */}
      <div className="absolute inset-0 z-0 overflow-hidden bg-brand-dark">
        <motion.div
          className="flex h-full"
          initial={false}
          animate={{ x: `${-(activeSlide * 100) / HERO_SLIDES.length}%` }}
          transition={{ duration: prefersReducedMotion ? 0 : 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: `${HERO_SLIDES.length * 100}%` }}
        >
          {HERO_SLIDES.map(slide => (
            <div key={slide.src} className="relative h-full shrink-0" style={{ width: `${100 / HERO_SLIDES.length}%` }}>
              <img src={slide.src} alt={slide.alt} aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
            </div>
          ))}
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-b from-brand-dark/40 via-brand-dark/20 to-brand-dark/90 mix-blend-multiply" />
        <div className="absolute inset-0 bg-brand-primary/10 mix-blend-overlay" />
        <div className="absolute inset-x-0 bottom-8 z-20 flex justify-center gap-3">
          {HERO_SLIDES.map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`}
              onClick={() => setActiveSlide(i)}
              className={`h-2.5 rounded-full transition-all duration-300 shadow-md ${i === activeSlide ? 'w-10 bg-brand-secondary' : 'w-2.5 bg-brand-cream/60 hover:bg-brand-cream'}`} />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-center mb-8"
        >
          <p className="text-brand-cream/70 text-sm font-bold uppercase tracking-widest mb-3">Discover Luxury Stays</p>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-serif text-brand-cream mb-4 drop-shadow-lg">
            Find Your Sanctuary
          </h1>
          <p className="text-lg md:text-xl text-brand-cream/85 font-sans font-light max-w-2xl mx-auto drop-shadow">
            Hand-picked resorts, villas, and hotels across the Philippines and beyond.
          </p>
        </motion.div>

        {/* Search Widget */}
        <motion.div
          initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="w-full bg-brand-cream/97 backdrop-blur-xl rounded-2xl shadow-2xl border border-brand-primary/10 p-5"
        >
          <div className="flex flex-col xl:flex-row items-stretch xl:items-end gap-4">
            {/* Destination */}
            <div className="flex-1 group">
              <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-brand-dark/50">Destination</label>
              <div className="flex items-center gap-2 border-b-2 border-brand-secondary/30 pb-2 group-focus-within:border-brand-primary transition-colors">
                <MapPin className="w-4 h-4 text-brand-primary shrink-0" />
                <input
                  id="hero-destination"
                  type="text"
                  value={destination}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setDestination(sanitize(e.target.value))}
                  onKeyDown={e => e.key === 'Enter' && void handleSearch()}
                  placeholder="Where are you going? or “hotels near me”"
                  className="bg-transparent border-none outline-none text-brand-dark placeholder-brand-dark/35 text-base font-serif italic w-full"
                />
              </div>
            </div>

            {/* Check-in */}
            <div className="flex-1 xl:max-w-[180px] group">
              <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-brand-dark/50">Check-in</label>
              <div className="flex items-center gap-2 border-b-2 border-brand-secondary/30 pb-2 group-focus-within:border-brand-primary transition-colors">
                <Calendar className="w-4 h-4 text-brand-primary shrink-0" />
                <input
                  type="date"
                  value={checkIn}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  onChange={e => {
                    setCheckIn(e.target.value);
                    if (e.target.value >= checkOut) setCheckOut(format(addDays(new Date(e.target.value), 1), 'yyyy-MM-dd'));
                  }}
                  className="bg-transparent border-none outline-none text-brand-dark text-base font-serif w-full cursor-pointer"
                />
              </div>
            </div>

            {/* Check-out */}
            <div className="flex-1 xl:max-w-[180px] group">
              <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-brand-dark/50">Check-out</label>
              <div className="flex items-center gap-2 border-b-2 border-brand-secondary/30 pb-2 group-focus-within:border-brand-primary transition-colors">
                <Calendar className="w-4 h-4 text-brand-primary shrink-0" />
                <input
                  type="date"
                  value={checkOut}
                  min={checkIn ? format(addDays(new Date(checkIn), 1), 'yyyy-MM-dd') : format(addDays(new Date(), 1), 'yyyy-MM-dd')}
                  onChange={e => setCheckOut(e.target.value)}
                  className="bg-transparent border-none outline-none text-brand-dark text-base font-serif w-full cursor-pointer"
                />
              </div>
            </div>

            {/* Guests */}
            <div ref={guestPanelRef} className="flex-1 xl:max-w-[220px] relative">
              <label className="block text-[10px] uppercase font-bold tracking-widest mb-2 text-brand-dark/50">Guests & Rooms</label>
              <button
                type="button"
                onClick={() => setShowGuestPanel(!showGuestPanel)}
                className="w-full flex items-center gap-2 border-b-2 border-brand-secondary/30 pb-2 hover:border-brand-primary transition-colors text-left"
              >
                <Users className="w-4 h-4 text-brand-primary shrink-0" />
                <span className="text-base font-serif italic text-brand-dark flex-1 truncate">{guestLabel}</span>
                <ChevronDown className={`w-4 h-4 text-brand-primary/60 transition-transform duration-200 ${showGuestPanel ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {showGuestPanel && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.97 }}
                    transition={{ duration: 0.18 }}
                    className="absolute top-full left-0 right-0 mt-2 bg-brand-cream rounded-2xl border border-brand-primary/15 shadow-xl z-50 p-4 min-w-[240px]"
                  >
                    <Stepper label="Adults" value={adults} onInc={() => setAdults(a => a + 1)} onDec={() => setAdults(a => Math.max(1, a - 1))} min={1} />
                    <Stepper label="Children" value={children} onInc={() => setChildren(c => c + 1)} onDec={() => setChildren(c => Math.max(0, c - 1))} />
                    <Stepper label="Rooms" value={rooms} onInc={() => setRooms(r => r + 1)} onDec={() => setRooms(r => Math.max(1, r - 1))} min={1} />
                    <button type="button" onClick={() => setShowGuestPanel(false)} className="mt-3 w-full btn-primary text-xs">Done</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Search Button */}
            <button
              type="button"
              id="hero-search-btn"
              onClick={() => void handleSearch()}
              disabled={isLocating}
              className="w-full xl:w-auto px-10 py-4 bg-brand-primary text-brand-cream rounded-xl font-bold tracking-widest uppercase text-xs flex items-center justify-center gap-2 hover:bg-brand-hover transition-all duration-300 active:scale-95 shadow-lg disabled:opacity-70"
            >
              {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
              <span>{isLocating ? 'Locating…' : 'Search'}</span>
            </button>
          </div>
        </motion.div>

        {/* Trust indicators */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
          className="flex items-center gap-6 mt-6 text-brand-cream/70 text-xs font-bold"
        >
          <span>✓ Free cancellation available</span>
          <span>✓ Best price guarantee</span>
          <span>✓ No booking fees</span>
        </motion.div>
      </div>
    </div>
  );
}
