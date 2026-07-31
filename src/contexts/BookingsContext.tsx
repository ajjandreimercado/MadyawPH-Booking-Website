import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { BookingRequest } from '../types';

interface BookingsContextType {
  bookings: BookingRequest[];
  isLoading: boolean;
  error: string | null;
  appendBooking: (booking: BookingRequest) => void;
  refetch: () => Promise<void>;
}

const BookingsContext = createContext<BookingsContextType | undefined>(undefined);

/**
 * Lightweight in-session booking cache for the guest site.
 * Account history / management lives in the hotel management app (shared MongoDB).
 */
export function BookingsProvider({ children }: { children: ReactNode }) {
  const [bookings, setBookings] = useState<BookingRequest[]>([]);

  const refetch = useCallback(async () => {
    // No guest account API on this site — hotel app owns booking management.
  }, []);

  const appendBooking = useCallback((booking: BookingRequest) => {
    setBookings((prev) => {
      const exists = prev.some((b) => b.id === booking.id);
      if (exists) return prev;
      return [booking, ...prev];
    });
  }, []);

  return (
    <BookingsContext.Provider value={{ bookings, isLoading: false, error: null, appendBooking, refetch }}>
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
