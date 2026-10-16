import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { fetchDestinations, type Destination } from '../services/api';
import { DestinationCard } from './HomePage';

/** Every city that has at least one partner hotel, from live inventory. */
export default function DestinationsPage() {
  const navigate = useNavigate();
  const [destinations, setDestinations] = useState<Destination[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchDestinations()
      .then((list) => { if (active) setDestinations(list); })
      .catch(() => { if (active) setDestinations([]); });
    return () => { active = false; };
  }, []);

  return (
    <div className="min-h-screen bg-brand-background pt-24 pb-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-primary">Destinations</p>
        <h1 className="mt-3 mb-8 text-3xl sm:text-4xl font-display font-semibold text-brand-dark">Where you can stay</h1>

        {destinations === null ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-primary animate-spin" /></div>
        ) : destinations.length === 0 ? (
          <p className="text-sm text-brand-dark/70">
            No destinations are listed right now. <Link to="/search" className="font-bold text-brand-primary">Browse all stays</Link>
          </p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {destinations.map((dest) => (
              <DestinationCard
                key={dest.name}
                dest={dest}
                onClick={() => navigate(`/search?destination=${encodeURIComponent(dest.query)}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
