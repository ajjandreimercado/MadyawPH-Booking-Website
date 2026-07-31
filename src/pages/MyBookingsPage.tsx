import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Calendar, MapPin, Download, XCircle, Star, ExternalLink, Clock, CheckCircle, RefreshCw } from 'lucide-react';
import { useBookings } from '../contexts/BookingsContext';
import { cancelBooking, updateBookingRequest, retryBookingConfirmation } from '../services/api';
import { useToast } from '../components/ui/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import type { BookingRequest } from '../types';
import { downloadReceiptPdf } from '../lib/receiptPdf';

type BookingTab = 'pending' | 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-brand-warning/10 text-brand-warning',
  requested: 'bg-brand-warning/10 text-brand-warning',
  reserved: 'bg-brand-warning/10 text-brand-warning',
  accepted: 'bg-brand-success/10 text-brand-success',
  booked: 'bg-brand-success/10 text-brand-success',
  confirmed: 'bg-brand-success/10 text-brand-success',
  paid: 'bg-brand-success/10 text-brand-success',
  declined: 'bg-brand-danger/10 text-brand-danger',
  cancelled: 'bg-brand-danger/10 text-brand-danger',
  completed: 'bg-gray-500/10 text-gray-500',
};

function BookingCard({
  booking,
  onCancel,
  onApprove,
  onRetryNotification,
  canManageReservations,
}: {
  booking: BookingRequest;
  onCancel: (id: string) => void;
  onApprove: (id: string) => void;
  onRetryNotification: (id: string) => void;
  canManageReservations: boolean;
}) {
  const navigate = useNavigate();
  const [isDownloading, setIsDownloading] = useState(false);
  const isPending = booking.status === 'pending' || booking.status === 'requested';
  const isUpcoming = isPending || booking.status === 'reserved' || booking.status === 'booked' || booking.status === 'confirmed' || booking.status === 'accepted';
  const isCancelled = booking.status === 'declined' || booking.status === 'cancelled';
  const isCompleted = booking.status === 'completed' || booking.status === 'paid';

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadReceiptPdf(booking);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="border border-brand-primary/10 rounded-2xl overflow-hidden bg-brand-surface">
      <div className="flex flex-col md:flex-row gap-0">
        {/* Color accent strip */}
        <div className={`md:w-1.5 h-1.5 md:h-auto shrink-0 ${isCompleted ? 'bg-brand-success' : isCancelled ? 'bg-brand-danger' : 'bg-brand-warning'}`} />
        <div className="flex-1 p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-serif font-bold text-lg text-brand-dark">{booking.propertyName}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_COLOR[booking.status] ?? 'bg-brand-secondary/10 text-brand-secondary'}`}>
                  {booking.status}
                </span>
              </div>
              <p className="text-sm font-bold text-brand-dark/60 capitalize">{booking.roomType?.replace(/-/g, ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/40">Total</p>
              <p className="text-xl font-serif font-bold text-brand-primary">₱{(booking.totalPrice ?? 0).toLocaleString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 text-sm">
            <div className="flex items-center gap-1.5 text-brand-dark/60 font-bold">
              <Calendar className="w-3.5 h-3.5 text-brand-primary" />
              {booking.checkInDate}
            </div>
            <div className="flex items-center gap-1.5 text-brand-dark/60 font-bold">
              <Calendar className="w-3.5 h-3.5 text-brand-primary" />
              {booking.checkOutDate}
            </div>
            <div className="flex items-center gap-1.5 text-brand-dark/60 font-bold">
              <Clock className="w-3.5 h-3.5 text-brand-primary" />
              {booking.nights} night{booking.nights !== 1 ? 's' : ''}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void handleDownload(); }}
              disabled={isDownloading}
              className="btn-outline text-xs flex items-center gap-1.5 py-2 px-3 disabled:opacity-60"
            >
              {isDownloading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> PDF…</>
                : <><Download className="w-3.5 h-3.5" /> Receipt</>}
            </button>
            {canManageReservations && isPending && (
              <button type="button" onClick={() => onApprove(booking.id)}
                className="px-3 py-2 bg-brand-success text-white text-xs font-bold rounded-xl hover:bg-brand-success/90 transition-colors flex items-center gap-1.5 shadow-sm">
                <CheckCircle className="w-3.5 h-3.5" /> Approve & Confirm
              </button>
            )}
            {isUpcoming && (
              <button type="button" onClick={() => onCancel(booking.id)}
                className="px-3 py-2 border border-brand-danger/30 text-brand-danger text-xs font-bold rounded-xl hover:bg-brand-danger/5 transition-colors flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" /> Cancel
              </button>
            )}
            {isCompleted && (
              <button type="button" onClick={() => navigate(`/review/new?bookingId=${booking.id}`)}
                className="btn-primary text-xs flex items-center gap-1.5 py-2 px-3">
                <Star className="w-3.5 h-3.5" /> Leave Review
              </button>
            )}
            <button type="button" onClick={() => navigate(`/booking/confirm/${booking.id}?email=${encodeURIComponent(booking.guestEmail)}`)}
              className="btn-outline text-xs flex items-center gap-1.5 py-2 px-3">
              <ExternalLink className="w-3.5 h-3.5" /> View Details
            </button>
          </div>

          {canManageReservations && booking.confirmationSendStatus === 'failed' && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-red-700">
              <span>Confirmation notification delivery failed: {booking.confirmationSendError || 'Delivery error'}</span>
              <button type="button" onClick={() => onRetryNotification(booking.id)}
                className="inline-flex items-center gap-1 font-bold underline text-red-800 hover:text-red-950 shrink-0">
                <RefreshCw className="w-3.5 h-3.5" /> Retry Send Confirmation
              </button>
            </div>
          )}

          {canManageReservations && booking.confirmationSendStatus === 'sent' && (
            <div className="mt-3 text-[11px] text-emerald-700 font-bold flex items-center gap-1">
              Confirmation notification marked sent ({booking.confirmationSentAt ? new Date(booking.confirmationSentAt).toLocaleString() : 'Done'})
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyBookingsPage() {
  const { bookings, isLoading, error, refetch } = useBookings();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<BookingTab>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const canManageReservations = user?.role === 'admin' || user?.role === 'staff' || user?.role === 'super_admin';

  // Always fetch fresh bookings from the server when this page is visited
  useEffect(() => {
    void refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const classify = (b: BookingRequest): BookingTab => {
    if (b.status === 'declined' || b.status === 'cancelled') return 'cancelled';
    if (b.status === 'pending' || b.status === 'requested') return 'pending';
    
    const now = new Date();
    const checkIn = new Date(b.checkInDate);
    const checkOut = new Date(b.checkOutDate);
    
    // Only classify as completed if explicitly marked, or paid AND checkout date has passed
    if (b.status === 'completed' || (b.status === 'paid' && now > checkOut)) return 'completed';
    
    // If it's ongoing (currently checked-in)
    if (now >= checkIn && now <= checkOut) return 'ongoing';
    
    // If checkout has already passed but not marked completed/cancelled, treat as completed
    if (now > checkOut) return 'completed';
    
    return 'upcoming';
  };

  const filtered = bookings.filter(b => classify(b) === activeTab);

  const TABS: { key: BookingTab; label: string }[] = [
    { key: 'pending', label: `Pending Requests (${bookings.filter(b => classify(b) === 'pending').length})` },
    { key: 'upcoming', label: `Confirmed (${bookings.filter(b => classify(b) === 'upcoming').length})` },
    { key: 'ongoing', label: `Ongoing (${bookings.filter(b => classify(b) === 'ongoing').length})` },
    { key: 'completed', label: `Completed (${bookings.filter(b => classify(b) === 'completed').length})` },
    { key: 'cancelled', label: `Cancelled (${bookings.filter(b => classify(b) === 'cancelled').length})` },
  ];

  const handleApprove = async (bookingId: string) => {
    setProcessingId(bookingId);
    try {
      await updateBookingRequest(bookingId, { status: 'confirmed' });
      await refetch();
      showToast({ title: 'Reservation confirmed & confirmation message sent to guest!', type: 'success' });
    } catch (err) {
      showToast({ title: 'Failed to confirm reservation', description: err instanceof Error ? err.message : 'Please try again.', type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleRetryNotification = async (bookingId: string) => {
    setProcessingId(bookingId);
    try {
      await retryBookingConfirmation(bookingId);
      await refetch();
      showToast({ title: 'Confirmation notification re-sent successfully!', type: 'success' });
    } catch (err) {
      showToast({ title: 'Retry failed', description: err instanceof Error ? err.message : 'Please try again.', type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (bookingId: string) => {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    setProcessingId(bookingId);
    try {
      await cancelBooking(bookingId);
      await refetch();
      showToast({ title: 'Booking cancelled successfully', type: 'success' });
    } catch (err) {
      showToast({ title: 'Failed to cancel booking', description: err instanceof Error ? err.message : 'Please try again.', type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-brand-dark/60 font-bold mb-4">{error}</p>
        <button type="button" onClick={() => void refetch()} className="btn-outline text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-serif font-bold text-brand-dark">My Bookings</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-brand-dark/50">{bookings.length} total</span>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isLoading}
            title="Refresh bookings"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-primary/20 text-brand-primary text-xs font-bold hover:bg-brand-primary/5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-brand-background p-1 rounded-xl overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${activeTab === tab.key ? 'bg-brand-cream text-brand-primary shadow-sm' : 'text-brand-dark/60 hover:text-brand-dark'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Booking List */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Calendar className="w-12 h-12 text-brand-primary/20 mx-auto mb-3" />
          <p className="font-bold text-brand-dark/60">No {activeTab} bookings</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(booking => (
            <div key={booking.id} className={processingId === booking.id ? 'opacity-50 pointer-events-none' : ''}>
              <BookingCard
                booking={booking}
                onCancel={handleCancel}
                onApprove={handleApprove}
                onRetryNotification={handleRetryNotification}
                canManageReservations={canManageReservations}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
