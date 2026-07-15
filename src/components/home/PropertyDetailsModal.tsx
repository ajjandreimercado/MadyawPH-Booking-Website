import { motion, AnimatePresence } from 'motion/react';
import { X, MapPin, Star, Check } from 'lucide-react';
import { Property } from '../../types';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import AuthModal from '../auth/AuthModal';
import { trackDetailsViewed } from '../../lib/analytics';

interface PropertyDetailsModalProps {
  property: Property | null;
  onClose: () => void;
}

export default function PropertyDetailsModal({ property, onClose }: PropertyDetailsModalProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const hasTrackedView = useRef(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!property || hasTrackedView.current) {
      return;
    }

    trackDetailsViewed(property);
    hasTrackedView.current = true;
  }, [property]);

  if (!property) return null;

  const handleBookNow = () => {
    if (user) {
      onClose();
      navigate(`/transaction/${property.id}`);
    } else {
      setShowAuthModal(true);
    }
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
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

          {/* Image Section */}
          <div className="w-full md:w-1/2 h-64 md:h-auto min-h-[300px] relative">
            <img 
              src={property.image} 
              alt={property.name} 
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>

          {/* Content Section */}
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

            {user && (
              <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-1">Signed in</p>
                <p className="text-sm font-bold text-emerald-900">You're signed in as {user.name}</p>
                <p className="text-xs font-bold text-emerald-800/80 mt-1">This modal has refreshed. You can continue to booking below.</p>
              </div>
            )}

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
              Madyaw offers exclusive rates and complementary upgrades for this property.
            </p>

            <div className="mb-8">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-brand-dark mb-4 drop-shadow-sm">Featured Amenities</h3>
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
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark mb-1 drop-shadow-sm">Total Price</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-serif font-bold text-brand-primary">${property.price}</span>
                  <span className="text-sm font-sans font-bold text-brand-dark">/ night</span>
                </div>
              </div>
              <button 
                type="button"
                onClick={handleBookNow}
                className="px-8 py-4 bg-brand-primary text-brand-cream text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-brand-hover transition-all active:scale-95 shadow-md focus:ring-4 focus:ring-brand-primary/20 outline-none"
              >
                {user ? 'Continue to Booking' : 'Request to Book'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)}
        onSuccess={handleAuthSuccess}
      />
    </AnimatePresence>
  );
}
