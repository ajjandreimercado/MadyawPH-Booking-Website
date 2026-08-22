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
  { src: '/hero/slide-1.png', alt: 'Tricycles along a city street in Butuan' },
  { src: '/hero/slide-2.png', alt: 'Plaza with the Philippine flag and shade trees' },
  { src: '/hero/slide-3.png', alt: 'Steel bridge over a river in the Philippines' },
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
    if (safeDestination) {
      params.set('destination', safeDestination);
      params.set('sort', 'distance');
    }
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
    // Mobile: grow with content (fixed vh was clipping headline under the nav and
    // painting the search card over the trust line / next section).
    <div className="relative flex flex-col justify-start md:justify-center pt-24 pb-8 sm:pt-28 sm:pb-10 md:min-h-[min(82vh,56rem)] md:pt-28 md:pb-14 landscape:min-h-0 landscape:py-24">
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
        <div className="absolute inset-0 bg-gradient-to-b from-brand-dark/70 via-brand-dark/50 to-brand-dark/88" />
        <div className="absolute inset-0 bg-brand-dark/20" />
      </div>

      {/* Content — normal document flow so nothing overlaps */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 flex flex-col items-center gap-4 sm:gap-6 md:gap-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-center w-full"
        >
          <p className="hidden sm:block text-brand-gold text-sm font-bold uppercase tracking-[0.25em] mb-4 [text-shadow:0_1px_8px_rgba(0,0,0,0.65)]">
            Discover Luxury Stays
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-serif font-bold text-brand-cream mb-4 sm:mb-5 leading-[1.05] tracking-tight [text-shadow:0_2px_24px_rgba(0,0,0,0.55),0_1px_2px_rgba(0,0,0,0.8)]">
            Find Your{' '}
            <span className="relative inline-block font-display italic font-semibold text-[#C5DCF5] tracking-normal [text-shadow:0_2px_18px_rgba(10,25,47,0.9),0_1px_0_rgba(10,25,47,0.95)]">
              Sanctuary
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 -bottom-1 sm:-bottom-2 h-1 sm:h-1.5 rounded-full bg-[#C5DCF5]"
              />
            </span>
          </h1>
          <p className="text-sm sm:text-lg md:text-xl text-brand-cream font-sans font-medium max-w-2xl mx-auto px-1 leading-relaxed [text-shadow:0_1px_12px_rgba(0,0,0,0.45)]">
            Hand-picked resorts, villas, and hotels across the Philippines and beyond.
          </p>
        </motion.div>

        {/* Search Widget */}
        <motion.div
          initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="w-full bg-brand-cream/97 backdrop-blur-xl rounded-2xl shadow-2xl border border-brand-primary/10 p-4 sm:p-5"
        >
          <div className="grid grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,11rem)_minmax(0,11rem)_minmax(0,14rem)_auto] items-end gap-4">
            {/* Destination */}
            <div className="min-[520px]:col-span-2 xl:col-span-1 group min-w-0">
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
                  className="bg-transparent border-none outline-none text-brand-dark placeholder-brand-dark/35 text-base font-serif italic w-full min-w-0"
                />
              </div>
            </div>

            {/* Check-in */}
            <div className="group min-w-0">
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
            <div className="group min-w-0">
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
            <div ref={guestPanelRef} className="relative min-w-0">
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
              className="w-full min-[520px]:col-span-2 xl:col-span-1 xl:w-auto px-8 py-4 bg-brand-primary text-brand-cream rounded-xl font-bold tracking-widest uppercase text-xs flex items-center justify-center gap-2 hover:bg-brand-hover transition-all duration-300 active:scale-95 shadow-lg disabled:opacity-70"
            >
              {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
              <span>{isLocating ? 'Locating…' : 'Search'}</span>
            </button>
          </div>
        </motion.div>

        {/* Trust indicators — in-flow below search, never under the card */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
          className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-x-6 gap-y-2 text-brand-cream/80 text-xs font-bold px-2 text-center"
        >
          <span>✓ Free cancellation available</span>
          <span>✓ Best price guarantee</span>
          <span>✓ No booking fees</span>
        </motion.div>

        {/* Slide dots sit in flow so they cannot cover copy */}
        <div className="flex justify-center gap-3 pt-1">
          {HERO_SLIDES.map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`}
              onClick={() => setActiveSlide(i)}
              className={`h-2.5 rounded-full transition-all duration-300 shadow-md ${i === activeSlide ? 'w-10 bg-brand-secondary' : 'w-2.5 bg-brand-cream/60 hover:bg-brand-cream'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
