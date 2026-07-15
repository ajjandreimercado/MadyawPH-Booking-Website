import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchBookings } from '../services/api';
import type { BookingRequest } from '../types';
import { useAuth } from './AuthContext';

interface BookingsContextType {
  bookings: BookingRequest[];
  isLoading: boolean;
  error: string | null;
  appendBooking: (booking: BookingRequest) => void;
  refetch: () => Promise<void>;
}

const BookingsContext = createContext<BookingsContextType | undefined>(undefined);

export function BookingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<BookingRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the user id that was last fetched so we don't re-fetch unnecessarily on mount.
  const lastFetchedUserId = useRef<string | null>(null);

  const refetch = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchBookings({ limit: 200 });
      setBookings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      // Clear bookings when user logs out.
      setBookings([]);
      lastFetchedUserId.current = null;
      return;
    }

    // Avoid duplicate fetches when the component re-renders but the user hasn't changed.
    if (lastFetchedUserId.current === user.id) return;
    lastFetchedUserId.current = user.id;

    void refetch();
  }, [user, refetch]);

  /**
   * Prepend a freshly created booking to the top of the list so it appears
   * immediately in My Bookings without waiting for a full refetch.
   */
  const appendBooking = useCallback((booking: BookingRequest) => {
    setBookings((prev) => {
      // Avoid duplicates if the booking is somehow already in the list.
      const exists = prev.some((b) => b.id === booking.id);
      if (exists) return prev;
      return [booking, ...prev];
    });
    // Also schedule a background refetch so the list stays in sync with the server
    // (e.g. if the server applied any transformations or the booking already existed).
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
