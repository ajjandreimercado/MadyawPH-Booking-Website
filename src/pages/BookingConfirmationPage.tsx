import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { CheckCircle2, Home, Download, MapPin, Calendar, Users, CreditCard, Loader2, Clock } from 'lucide-react';
import { fetchBookingById } from '../services/api';
import type { BookingRequest } from '../types';
import { downloadReceiptPdf } from '../lib/receiptPdf';

function statusLabel(status?: string) {
  switch (status) {
    case 'confirmed':
    case 'paid':
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

export default function BookingConfirmationPage() {
  const { bookingId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<BookingRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    setIsLoading(true);
    const guestEmail = searchParams.get('email') ?? undefined;
    const receiptToken = searchParams.get('token') ?? undefined;
    fetchBookingById(bookingId, guestEmail, receiptToken)
      .then(b => { setBooking(b); setIsLoading(false); })
      .catch(err => { setError(err instanceof Error ? err.message : 'Unable to load booking'); setIsLoading(false); });
  }, [bookingId, searchParams]);

  const handleDownload = async () => {
    if (!booking || isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadReceiptPdf(booking);
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-brand-background flex items-center justify-center pt-32 pb-16">
        <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-brand-background flex items-center justify-center p-4 pt-32 pb-16">
        <div className="bg-brand-cream rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-serif font-bold text-brand-dark mb-3">Booking Not Found</h2>
          <p className="text-brand-dark/60 font-bold mb-6">{error}</p>
          <button onClick={() => navigate('/')} className="btn-primary">Return Home</button>
        </div>
      </div>
    );
  }

  const isPending = booking.status === 'pending' || booking.status === 'requested';

  return (
    <div className="min-h-screen bg-brand-background pt-32 pb-20">
      <div className="max-w-2xl mx-auto px-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="text-center mb-8"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
            className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${isPending ? 'bg-brand-warning/10' : 'bg-brand-success/10'}`}
          >
            {isPending
              ? <Clock className="w-12 h-12 text-brand-warning" />
              : <CheckCircle2 className="w-12 h-12 text-brand-success" />}
          </motion.div>
          <h1 className="text-4xl font-serif font-bold text-brand-dark mb-2">
            {isPending ? 'Reservation Request Received' : 'Reservation Updated'}
          </h1>
          <p className="text-brand-dark/70 font-medium text-sm mt-1 max-w-md mx-auto leading-relaxed">
            {isPending
              ? <>We saved your request for <span className="font-bold text-brand-primary">{booking.guestEmail}</span>. Status is <span className="font-bold">{statusLabel(booking.status)}</span>. The hotel will review it in their management system and email you at this address when they accept or decline.</>
              : <>Your reservation for <span className="font-bold text-brand-primary">{booking.guestEmail}</span> is now <span className="font-bold">{statusLabel(booking.status)}</span>.</>}
          </p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
          className="bg-gradient-to-r from-brand-primary to-brand-hover text-white rounded-2xl p-6 mb-6 text-center"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-white/70 mb-1">Booking Reference</p>
          <p className="text-3xl font-serif font-bold tracking-wider">{(booking as { bookingReference?: string }).bookingReference ?? booking.id.slice(0, 12).toUpperCase()}</p>
          <p className="text-xs text-white/60 mt-1 font-bold">Status: {statusLabel(booking.status)}</p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
          className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-6 mb-6"
        >
          <h2 className="text-xl font-serif font-bold text-brand-dark mb-5">Reservation Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: Home, label: 'Property', value: booking.propertyName },
              { icon: MapPin, label: 'Room Type', value: booking.roomType?.replace(/-/g, ' ') },
              { icon: Calendar, label: 'Check-in', value: booking.checkInDate },
              { icon: Calendar, label: 'Check-out', value: booking.checkOutDate },
              { icon: Users, label: 'Guests', value: `${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? ` + ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}` },
              { icon: CreditCard, label: 'Preferred payment', value: booking.paymentMethod?.replace(/-/g, ' ') },
            ].map(item => (
              <div key={item.label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-brand-primary/10 flex items-center justify-center shrink-0">
                  <item.icon className="w-4 h-4 text-brand-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/40">{item.label}</p>
                  <p className="font-bold text-brand-dark capitalize">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }}
          className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-6 mb-6"
        >
          <h2 className="text-xl font-serif font-bold text-brand-dark mb-4">Amount Summary</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm font-bold">
              <span className="text-brand-dark/60">Room rate ({booking.nights} nights)</span>
              <span>₱{(booking.roomRate ?? 0).toLocaleString()}</span>
            </div>
            {(booking.discountAmount ?? 0) > 0 && (
              <div className="flex justify-between text-sm font-bold text-brand-success">
                <span>Discount</span>
                <span>−₱{(booking.discountAmount ?? 0).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between font-serif font-bold text-lg border-t border-brand-primary/8 pt-3">
              <span>Stay total</span>
              <span className="text-brand-dark">₱{(booking.totalPrice ?? 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-1">
              <span className="text-brand-primary">Partial payment (50% recorded)</span>
              <span className="text-brand-primary">
                ₱{(booking.amountPaid ?? Math.floor((booking.totalPrice ?? 0) / 2)).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold">
              <span className="text-brand-dark/60">Balance at hotel check-out</span>
              <span>
                ₱{(
                  booking.balanceDue
                  ?? Math.max(0, (booking.totalPrice ?? 0) - (booking.amountPaid ?? Math.floor((booking.totalPrice ?? 0) / 2)))
                ).toLocaleString()}
              </span>
            </div>
            <p className="text-[11px] font-bold text-brand-dark/45 pt-1">
              Only the 50% deposit is recorded as paid. The remaining balance is collected when you check out at the hotel — not as a full website payment.
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6 }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <button
            type="button"
            onClick={() => { void handleDownload(); }}
            disabled={isDownloading}
            className="btn-outline flex-1 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isDownloading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF…</>
              : <><Download className="w-4 h-4" /> Download PDF Summary</>}
          </button>
          <Link to="/" className="btn-primary flex-1 flex items-center justify-center gap-2">
            <Home className="w-4 h-4" /> Return Home
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
