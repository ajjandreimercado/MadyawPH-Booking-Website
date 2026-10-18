import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { BookingRequest } from '../types';
import { fetchBookings, isAxiosError } from '../services/api';
import { useAuth } from './AuthContext';
import { errorMessageFromUnknown } from '../lib/apiError';

interface BookingsContextType {
  bookings: BookingRequest[];
  isLoading: boolean;
  error: string | null;
  appendBooking: (booking: BookingRequest) => void;
  refetch: () => Promise<void>;
}

const BookingsContext = createContext<BookingsContextType | undefined>(undefined);

/**
 * Guest trip history — loads from GET /bookings when signed in.
 */
export function BookingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<BookingRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!user) {
      setBookings([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const list = await fetchBookings({ limit: 100 });
      setBookings(list);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 401) {
        setBookings([]);
        setError(null);
      } else {
        setError(errorMessageFromUnknown(err, 'Unable to load your trips.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const appendBooking = useCallback((booking: BookingRequest) => {
    setBookings((prev) => {
      const exists = prev.some((b) => b.id === booking.id);
      if (exists) return prev;
      return [booking, ...prev];
    });
  }, []);

  return (
    <BookingsContext.Provider value={{ bookings, isLoading, error, appendBooking, refetch }}>
      {children}
    </BookingsContext.Provider>
  );
}

export function useBookings() {
  const context = useContext(BookingsContext);
  if (!context) {
    throw new Error('useBookings must be used within a BookingsProvider');
  }
  return context;
}
