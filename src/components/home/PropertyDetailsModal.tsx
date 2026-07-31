import { motion, AnimatePresence } from 'motion/react';
import { X, MapPin, Star, Check } from 'lucide-react';
import { Property } from '../../types';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { trackDetailsViewed } from '../../lib/analytics';

interface PropertyDetailsModalProps {
  property: Property | null;
  onClose: () => void;
}

export default function PropertyDetailsModal({ property, onClose }: PropertyDetailsModalProps) {
  const hasTrackedView = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!property || hasTrackedView.current) {
      return;
    }

    trackDetailsViewed(property);
    hasTrackedView.current = true;
  }, [property]);

  if (!property) return null;

  const handleBookNow = () => {
    onClose();
    navigate(`/booking/${property.id}`);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-4xl max-h-[90vh] bg-brand-cream rounded-[2rem] shadow-xl overflow-y-auto flex flex-col md:flex-row border border-brand-primary/10"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close property details modal"
            className="absolute top-4 right-4 z-10 p-2 bg-brand-dark/80 hover:bg-brand-hover backdrop-blur text-brand-cream rounded-full transition-colors active:scale-95 shadow-md"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>

          <div className="w-full md:w-1/2 h-64 md:h-auto min-h-[300px] relative">
            <img
              src={property.image}
              alt={property.name}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>

          <div className="w-full md:w-1/2 p-8 md:p-10 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1 bg-brand-primary/10 text-brand-dark text-[10px] font-bold uppercase tracking-widest rounded-md">
                {property.type}
              </span>
              <div className="flex items-center gap-1 text-sm font-bold text-brand-dark">
                <Star className="w-4 h-4 fill-brand-primary text-brand-primary" />
                <span>{property.rating}</span>
                <span className="text-brand-dark font-normal">({property.reviews} reviews)</span>
              </div>
            </div>

            <h2 className="text-4xl font-serif font-bold text-brand-dark mb-2">{property.name}</h2>

            <div className="flex items-center gap-1.5 text-brand-dark text-sm mb-6 font-bold">
              <MapPin className="w-4 h-4" />
              <span>{property.location}</span>
              <span className="w-1 h-1 rounded-full bg-brand-dark mx-1" />
              <span>{property.distance}</span>
            </div>

            <p className="text-brand-dark font-sans leading-relaxed text-sm mb-8 font-medium">
              Experience unparalleled luxury and breathtaking views at <strong className="text-brand-primary">{property.name}</strong>.
              Indulge in world-class amenities designed to provide the ultimate sanctuary for your getaway.
            </p>

            <div className="mb-8">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-brand-dark mb-4">Featured Amenities</h3>
              <div className="grid grid-cols-2 gap-3">
                {(property.amenities ?? []).map((amenity, index) => (
                  <div key={`${amenity}-${index}`} className="flex items-center gap-2 text-sm font-bold text-brand-dark">
                    <Check className="w-4 h-4 text-brand-primary" />
                    <span>{amenity}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-auto flex items-center justify-between pt-6 border-t border-brand-primary/10">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark mb-1">From</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-serif font-bold text-brand-primary">₱{property.price.toLocaleString()}</span>
                  <span className="text-sm font-sans font-bold text-brand-dark">/ night</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBookNow}
                className="px-8 py-4 bg-brand-primary text-brand-cream text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-brand-hover transition-all active:scale-95 shadow-md focus:ring-4 focus:ring-brand-primary/20 outline-none"
              >
                Request to Book
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
