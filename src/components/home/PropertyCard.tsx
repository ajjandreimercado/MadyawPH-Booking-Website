import { motion } from 'motion/react';
import { Star, Heart } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Property } from '../../types';
import { useToast } from '../ui/ToastProvider';
import { trackCardViewed } from '../../lib/analytics';

const FAVORITES_KEY = 'madyaw_local_favorites';

function readLocalFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(ids: string[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

interface PropertyCardProps {
  property: Property;
  index: number;
  onViewDetails: (property: Property) => void;
}

export default function PropertyCard({ property, index, onViewDetails }: PropertyCardProps) {
  const [isFavorite, setIsFavorite] = useState(false);
  const { showToast } = useToast();
  const hasTrackedView = useRef(false);

  useEffect(() => {
    setIsFavorite(readLocalFavorites().includes(property.id));
  }, [property.id]);

  useEffect(() => {
    if (hasTrackedView.current) {
      return;
    }

    trackCardViewed(property);
    hasTrackedView.current = true;
  }, [property]);

  const handleFavorite = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const current = readLocalFavorites();
    if (isFavorite) {
      writeLocalFavorites(current.filter((id) => id !== property.id));
      setIsFavorite(false);
      showToast({ title: 'Removed from saved stays', type: 'success' });
      return;
    }
    writeLocalFavorites([...current, property.id]);
    setIsFavorite(true);
    showToast({ title: 'Saved on this device', type: 'success' });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="bg-brand-cream rounded-3xl overflow-hidden shadow-md hover:shadow-lg border border-brand-primary/10 group transition-all duration-300 flex flex-col"
    >
      <div className="h-52 bg-brand-dark/10 relative overflow-hidden">
        <img
          src={property.image}
          alt={property.name}
          className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 group-hover:opacity-100 transition-all duration-700 ease-out"
        />
        <div className="absolute top-4 right-4 bg-brand-cream/95 backdrop-blur border border-brand-primary/10 px-3 py-1 rounded-full text-[11px] font-sans font-bold text-brand-dark shadow-sm">
          {property.rating} Superb
        </div>
        <button
          type="button"
          onClick={handleFavorite}
          aria-label={isFavorite ? `Remove ${property.name} from favorites` : `Add ${property.name} to favorites`}
          aria-pressed={isFavorite}
          className="absolute top-4 left-4 p-2 bg-brand-cream/70 backdrop-blur-sm rounded-full active:scale-95 transition-transform hover:bg-brand-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-background"
        >
          <Heart className={`w-5 h-5 transition-colors ${isFavorite ? 'fill-brand-primary text-brand-primary' : 'text-brand-dark'}`} />
        </button>
      </div>

      <div className="p-6 flex flex-col flex-1">
        <div className="flex justify-between items-start gap-4">
          <h4 className="font-serif text-2xl font-bold text-brand-dark">
            {property.name}
          </h4>
          <div className="text-right">
            <p className="text-xl font-serif font-bold text-brand-primary">
              ₱{property.price.toLocaleString()}
              <span className="text-xs font-sans font-normal block text-brand-dark/70">per night</span>
            </p>
          </div>
        </div>

        <p className="text-xs mt-2 uppercase tracking-wider text-brand-dark font-bold line-clamp-1">
          {property.location} • {(property.amenities ?? []).slice(0, 2).join(' • ')}
        </p>

        <div className="h-px bg-brand-secondary/25 my-4" />

        <div className="flex justify-between items-center mt-auto">
          <div className="flex items-center gap-1.5 font-bold text-brand-dark text-sm">
            <Star className="w-4 h-4 fill-brand-primary text-brand-primary" />
            <span>{property.rating.toFixed(1)}</span>
          </div>
          <button
            type="button"
            onClick={() => onViewDetails(property)}
            className="px-5 py-2 bg-brand-primary text-brand-cream text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-brand-hover transition-all duration-300 active:scale-95 shadow-sm"
          >
            View Details
          </button>
        </div>
      </div>
    </motion.div>
  );
}
