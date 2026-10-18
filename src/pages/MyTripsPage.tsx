import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Download, Loader2, MapPin, Receipt } from 'lucide-react';
import { useBookings } from '../contexts/BookingsContext';
import { useAuth } from '../contexts/AuthContext';
import type { BookingRequest, BookingStatus } from '../types';
import { formatStayDate, peso } from '../lib/stayParams';
import { useToast } from '../components/ui/ToastProvider';

type TripFilter = 'all' | 'upcoming' | 'confirmed' | 'pending' | 'cancelled';

function statusLabel(status?: BookingStatus | string) {
  switch (status) {
    case 'confirmed':
    case 'reserved':
    case 'booked':
    case 'paid':
      return 'Confirmed';
    case 'accepted':
      return 'Accepted';
    case 'declined':
    case 'cancelled':
      return 'Cancelled';
    case 'pending':
    case 'requested':
    default:
      return 'Pending review';
  }
}

function statusTone(status?: BookingStatus | string) {
  switch (status) {
    case 'confirmed':
    case 'reserved':
    case 'booked':
    case 'paid':
    case 'accepted':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'declined':
    case 'cancelled':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-amber-50 text-amber-800 border-amber-200';
  }
}

function isConfirmed(status?: string) {
  return ['confirmed', 'reserved', 'booked', 'paid', 'accepted'].includes(String(status ?? ''));
}

function isCancelled(status?: string) {
  return ['cancelled', 'declined'].includes(String(status ?? ''));
}

function isPending(status?: string) {
  return !isConfirmed(status) && !isCancelled(status);
}

function matchesFilter(booking: BookingRequest, filter: TripFilter) {
  const status = booking.status;
  if (filter === 'all') return true;
  if (filter === 'confirmed') return isConfirmed(status);
  if (filter === 'cancelled') return isCancelled(status);
  if (filter === 'pending') return isPending(status);
  if (filter === 'upcoming') {
    const checkIn = new Date(booking.checkInDate).getTime();
    return isConfirmed(status) && Number.isFinite(checkIn) && checkIn >= Date.now() - 86_400_000;
  }
  return true;
}

export default function MyTripsPage() {
  const { user } = useAuth();
  const { bookings, isLoading, error, refetch } = useBookings();
  const { showToast } = useToast();
  const [filter, setFilter] = useState<TripFilter>('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const visible = useMemo(
    () => bookings.filter((b) => matchesFilter(b, filter)),
    [bookings, filter],
  );

  const handleDownload = async (booking: BookingRequest) => {
    if (downloadingId) return;
    setDownloadingId(booking.id);
    try {
      const { downloadReceiptPdf } = await import('../lib/receiptPdf');
      await downloadReceiptPdf(booking);
    } catch {
      showToast({ title: 'Could not download receipt', type: 'error' });
    } finally {
      setDownloadingId(null);
    }
  };

  const filters: { id: TripFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'pending', label: 'Pending' },
    { id: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div className="min-h-screen bg-brand-background pt-28 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-display font-semibold text-brand-dark tracking-tight">
            My trips
          </h1>
          <p className="mt-2 text-sm font-bold text-brand-dark/60">
            Bookings saved to {user?.email ?? 'your account'}. Open a trip for your receipt.
          </p>
        </header>

        <div className="flex flex-wrap gap-2 mb-6">
          {filters.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-widest rounded-lg border transition-colors ${
                filter === id
                  ? 'bg-brand-primary text-brand-cream border-brand-primary'
                  : 'bg-brand-cream text-brand-dark/70 border-brand-primary/15 hover:border-brand-primary/40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-brand-cream border border-red-200 rounded-2xl p-8 text-center">
            <p className="text-sm font-bold text-red-700 mb-4">{error}</p>
            <button type="button" onClick={() => void refetch()} className="btn-primary">
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-brand-cream border border-brand-primary/10 rounded-2xl p-10 text-center">
            <p className="text-lg font-display font-semibold text-brand-dark mb-2">No trips here yet</p>
            <p className="text-sm font-bold text-brand-dark/55 mb-6">
              When you book a stay, it will show up in this list with your receipt.
            </p>
            <Link to="/search" className="btn-primary inline-flex">Browse stays</Link>
          </div>
        ) : (
          <ul className="space-y-4">
            {visible.map((booking) => (
              <li
                key={booking.id}
                className="bg-brand-cream border border-brand-primary/10 rounded-2xl p-5 sm:p-6 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-lg font-display font-semibold text-brand-dark">
                      {booking.propertyName || 'Stay'}
                    </p>
                    {booking.bookingReference ? (
                      <p className="text-[11px] font-bold uppercase tracking-widest text-brand-dark/45 mt-1">
                        {booking.bookingReference}
                      </p>
                    ) : null}
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border ${statusTone(booking.status)}`}>
                    {statusLabel(booking.status)}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5 text-sm font-bold text-brand-dark/70 mb-4">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-brand-primary" />
                    {formatStayDate(booking.checkInDate)} → {formatStayDate(booking.checkOutDate)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-brand-primary" />
                    {booking.nights} {booking.nights === 1 ? 'night' : 'nights'} · {peso(booking.totalPrice)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/booking/confirm/${booking.id}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-primary text-brand-cream text-[11px] font-bold uppercase tracking-widest hover:bg-brand-hover transition-colors"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    View receipt
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleDownload(booking)}
                    disabled={downloadingId === booking.id}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-brand-primary/20 text-brand-dark text-[11px] font-bold uppercase tracking-widest hover:bg-brand-primary/5 transition-colors disabled:opacity-60"
                  >
                    {downloadingId === booking.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    Download PDF
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
