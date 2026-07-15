import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Star, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { createReview, fetchBookingById } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/ToastProvider';
import StarRating from '../components/ui/StarRating';
import type { BookingRequest } from '../types';

export default function ReviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const bookingId = searchParams.get('bookingId');

  const [booking, setBooking] = useState<BookingRequest | null>(null);
  const [isLoadingBooking, setIsLoadingBooking] = useState(Boolean(bookingId));
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    setIsLoadingBooking(true);
    fetchBookingById(bookingId)
      .then(b => { setBooking(b); setIsLoadingBooking(false); })
      .catch(() => setIsLoadingBooking(false));
  }, [bookingId]);

  const handleSubmit = async () => {
    if (rating === 0) {
      showToast({ title: 'Please select a star rating', type: 'error' });
      return;
    }
    if (!title.trim() || !comment.trim()) {
      showToast({ title: 'Please fill in title and comment', type: 'error' });
      return;
    }
    if (!booking) {
      showToast({ title: 'Booking context not found', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      await createReview({
        propertyId: booking.propertyId,
        authorName: booking.guestName || 'Guest',
        rating,
        title: title.trim(),
        comment: comment.trim(),
      });
      setSubmitted(true);
    } catch (err) {
      showToast({
        title: 'Failed to submit review',
        description: err instanceof Error ? err.message : 'Please try again.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-brand-background flex items-center justify-center p-4 pt-32 pb-16">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="bg-brand-cream rounded-2xl p-10 text-center max-w-sm shadow-lg border border-brand-primary/10"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-success/10 mb-4"
          >
            <CheckCircle2 className="w-10 h-10 text-brand-success" />
          </motion.div>
          <h2 className="text-2xl font-serif font-bold text-brand-dark mb-2">Review Published!</h2>
          <p className="text-brand-dark/60 font-bold mb-6">Thank you for sharing your experience.</p>
          <div className="flex flex-col gap-3">
            <button type="button" onClick={() => navigate('/dashboard/bookings')} className="btn-primary w-full">
              Back to My Bookings
            </button>
            <button type="button" onClick={() => navigate('/')} className="btn-outline w-full">
              Return Home
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-background pt-32 pb-20">
      <div className="max-w-2xl mx-auto px-4">
        <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm font-bold text-brand-dark/60 hover:text-brand-primary mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-warning/10 mb-3">
              <Star className="w-7 h-7 text-brand-warning fill-brand-warning" />
            </div>
            <h1 className="text-3xl font-serif font-bold text-brand-dark mb-1">Leave a Review</h1>
            {booking && (
              <p className="text-brand-dark/60 font-bold text-sm">
                {booking.propertyName} · {booking.checkInDate} – {booking.checkOutDate}
              </p>
            )}
            {isLoadingBooking && <Loader2 className="w-5 h-5 text-brand-primary animate-spin mx-auto mt-2" />}
          </div>

          <div className="space-y-6">
            {/* Star Rating */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 block mb-3">Overall Rating</label>
              <div className="flex items-center gap-3">
                <StarRating rating={rating} size="lg" interactive onRate={setRating} />
                {rating > 0 && (
                  <span className="text-sm font-bold text-brand-dark">
                    {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
                  </span>
                )}
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 block mb-2">Review Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Summarize your experience in one line…"
                className="input-field"
              />
              <p className="text-right text-[10px] text-brand-dark/30 font-bold mt-1">{title.length}/120</p>
            </div>

            {/* Comment */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 block mb-2">Your Review</label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={2000}
                rows={6}
                placeholder="Tell us about your stay — the room, service, location, food, and anything else worth mentioning…"
                className="input-field resize-none"
              />
              <p className="text-right text-[10px] text-brand-dark/30 font-bold mt-1">{comment.length}/2000</p>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || rating === 0}
              className="btn-primary w-full py-4 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
              ) : (
                <><Star className="w-4 h-4" /> Submit Review</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
