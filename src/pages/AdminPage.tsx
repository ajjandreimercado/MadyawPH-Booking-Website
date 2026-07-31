import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, CheckCircle, XCircle, Tag, RefreshCw, Shield } from 'lucide-react';
import {
  fetchBookings,
  updateBookingRequest,
  fetchAdminPromoCodes,
  createAdminPromoCode,
  deleteAdminPromoCode,
  type AdminPromoCode,
} from '../services/api';
import { useToast } from '../components/ui/ToastProvider';
import type { BookingRequest } from '../types';

export default function AdminPage() {
  const { showToast } = useToast();
  const [bookings, setBookings] = useState<BookingRequest[]>([]);
  const [promos, setPromos] = useState<AdminPromoCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [promoCode, setPromoCode] = useState('');
  const [promoType, setPromoType] = useState<'percentage' | 'fixed'>('percentage');
  const [promoValue, setPromoValue] = useState('10');
  const [promoDescription, setPromoDescription] = useState('');

  const load = async () => {
    setIsLoading(true);
    try {
      const [bookingList, promoList] = await Promise.all([
        fetchBookings({ limit: 100 }),
        fetchAdminPromoCodes(),
      ]);
      setBookings(bookingList);
      setPromos(promoList);
    } catch (err) {
      showToast({
        title: 'Unable to load admin data',
        description: err instanceof Error ? err.message : 'Please try again.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = async (bookingId: string, status: BookingRequest['status']) => {
    setProcessingId(bookingId);
    try {
      await updateBookingRequest(bookingId, { status });
      await load();
      showToast({ title: `Booking marked ${status}`, type: 'success' });
    } catch (err) {
      showToast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Please try again.',
        type: 'error',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreatePromo = async () => {
    if (!promoCode.trim()) {
      showToast({ title: 'Promo code is required', type: 'error' });
      return;
    }
    try {
      await createAdminPromoCode({
        code: promoCode.trim().toUpperCase(),
        discount_type: promoType,
        discount_value: Number(promoValue),
        description: promoDescription.trim(),
      });
      setPromoCode('');
      setPromoDescription('');
      await load();
      showToast({ title: 'Promo code created', type: 'success' });
    } catch (err) {
      showToast({
        title: 'Could not create promo',
        description: err instanceof Error ? err.message : 'Please try again.',
        type: 'error',
      });
    }
  };

  const handleDeletePromo = async (id?: string) => {
    if (!id) return;
    try {
      await deleteAdminPromoCode(id);
      await load();
      showToast({ title: 'Promo deleted', type: 'success' });
    } catch (err) {
      showToast({
        title: 'Could not delete promo',
        description: err instanceof Error ? err.message : 'Please try again.',
        type: 'error',
      });
    }
  };

  const pending = bookings.filter((b) => b.status === 'pending' || b.status === 'requested');

  return (
    <div className="min-h-screen bg-brand-background pt-32 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" /> Staff console
            </p>
            <h1 className="text-3xl font-serif font-bold text-brand-dark">Operations</h1>
            <p className="text-brand-dark/60 font-bold mt-1">
              Review reservation requests and manage promo codes.
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/dashboard/bookings" className="btn-outline text-sm">My account</Link>
            <button type="button" onClick={() => void load()} className="btn-primary text-sm inline-flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
          </div>
        ) : (
          <>
            <section className="bg-brand-cream rounded-2xl border border-brand-primary/10 p-6 space-y-4">
              <h2 className="font-serif font-bold text-xl text-brand-dark">
                Pending requests ({pending.length})
              </h2>
              {pending.length === 0 ? (
                <p className="text-sm font-bold text-brand-dark/50">No pending reservations.</p>
              ) : (
                <div className="space-y-3">
                  {pending.map((booking) => (
                    <div
                      key={booking.id}
                      className={`rounded-xl border border-brand-primary/10 bg-white/60 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${processingId === booking.id ? 'opacity-50' : ''}`}
                    >
                      <div>
                        <p className="font-serif font-bold text-brand-dark">{booking.propertyName}</p>
                        <p className="text-xs font-bold text-brand-dark/55">
                          {booking.guestName} · {booking.guestEmail} · {booking.checkInDate} → {booking.checkOutDate}
                        </p>
                        <p className="text-sm font-bold text-brand-primary mt-1">
                          ₱{(booking.totalPrice ?? 0).toLocaleString()} · {booking.paymentMethod}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void setStatus(booking.id, 'accepted')}
                          className="px-3 py-2 rounded-xl bg-brand-success text-white text-xs font-bold inline-flex items-center gap-1.5"
                        >
                          <CheckCircle className="w-3.5 h-3.5" /> Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => void setStatus(booking.id, 'confirmed')}
                          className="px-3 py-2 rounded-xl bg-brand-primary text-white text-xs font-bold"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => void setStatus(booking.id, 'declined')}
                          className="px-3 py-2 rounded-xl border border-brand-danger/30 text-brand-danger text-xs font-bold inline-flex items-center gap-1.5"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-brand-cream rounded-2xl border border-brand-primary/10 p-6 space-y-4">
              <h2 className="font-serif font-bold text-xl text-brand-dark flex items-center gap-2">
                <Tag className="w-5 h-5 text-brand-primary" /> Promo codes
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  className="input-field uppercase"
                  placeholder="CODE"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                />
                <select
                  className="input-field"
                  value={promoType}
                  onChange={(e) => setPromoType(e.target.value as 'percentage' | 'fixed')}
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
                <input
                  className="input-field"
                  type="number"
                  min={0}
                  value={promoValue}
                  onChange={(e) => setPromoValue(e.target.value)}
                />
                <button type="button" onClick={() => void handleCreatePromo()} className="btn-primary text-sm">
                  Create promo
                </button>
              </div>
              <input
                className="input-field"
                placeholder="Description (optional)"
                value={promoDescription}
                onChange={(e) => setPromoDescription(e.target.value)}
              />

              <div className="space-y-2">
                {promos.length === 0 ? (
                  <p className="text-sm font-bold text-brand-dark/50">No promo codes yet.</p>
                ) : (
                  promos.map((promo) => (
                    <div
                      key={promo._id ?? promo.code}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-brand-primary/10 bg-white/60 px-4 py-3"
                    >
                      <div>
                        <p className="font-bold text-brand-dark">{promo.code}</p>
                        <p className="text-xs font-bold text-brand-dark/55">
                          {promo.discount_type === 'percentage'
                            ? `${promo.discount_value}% off`
                            : `₱${promo.discount_value.toLocaleString()} off`}
                          {promo.description ? ` · ${promo.description}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeletePromo(promo._id)}
                        className="text-xs font-bold text-brand-danger underline"
                      >
                        Delete
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
