import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  CheckCircle2, Home, Download, MapPin, Calendar, Users, CreditCard,
  Loader2, Clock, Upload, Smartphone, Info,
} from 'lucide-react';
import { fetchBookingById, fetchHotelById, uploadBookingPaymentProof } from '../services/api';
import { errorMessageFromUnknown } from '../lib/apiError';
import type { BookingRequest, Hotel } from '../types';
import { downloadReceiptPdf } from '../lib/receiptPdf';
import {
  availableWalletMethods,
  paymentQrProxyUrl,
  WALLET_PAYMENT_OPTIONS,
  walletMethodLabel,
  walletMethodTheme,
  type WalletPaymentMethod,
} from '../lib/paymentQr';
import { ConfirmationSkeleton } from '../components/ui/Skeleton';
import { cacheKey, peekCache } from '../lib/queryCache';
import { useBookings } from '../contexts/BookingsContext';
import { useToast } from '../components/ui/ToastProvider';

function statusLabel(status?: string) {
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

export default function BookingConfirmationPage() {
  const { bookingId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { bookings } = useBookings();
  const { showToast } = useToast();
  const sessionBooking = bookings.find((b) => b.id === bookingId) ?? null;
  const [booking, setBooking] = useState<BookingRequest | null>(sessionBooking);
  const [hotel, setHotel] = useState<Hotel | null>(() =>
    sessionBooking?.hotelId
      ? peekCache<Hotel>(cacheKey(['hotel', sessionBooking.hotelId])) ?? null
      : null,
  );
  const [isLoading, setIsLoading] = useState(!sessionBooking);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const receiptToken = searchParams.get('token') ?? '';
  const forcePayParam = searchParams.get('pay') === '1';

  const [selectedWallet, setSelectedWallet] = useState<WalletPaymentMethod | null>(null);
  const [qrObjectUrl, setQrObjectUrl] = useState<string>();
  const [qrLoading, setQrLoading] = useState(false);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentTransactionRef, setPaymentTransactionRef] = useState('');
  const [paymentProofAmountClaimed, setPaymentProofAmountClaimed] = useState('');
  const [isUploadingProof, setIsUploadingProof] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    const guestEmail = searchParams.get('email') ?? undefined;
    if (!receiptToken) {
      setError('This confirmation link is incomplete or has expired. Please use the link from your booking email.');
      setIsLoading(false);
      return;
    }
    if (!sessionBooking) setIsLoading(true);
    fetchBookingById(bookingId, guestEmail, receiptToken)
      .then(async (b) => {
        setBooking(b);
        if (b.hotelId) {
          try {
            setHotel(await fetchHotelById(b.hotelId));
          } catch {
            setHotel(null);
          }
        }
        setIsLoading(false);
      })
      .catch(err => {
        if (!sessionBooking) {
          setError(errorMessageFromUnknown(err, 'Unable to load your booking right now.'));
        }
        setIsLoading(false);
      });
  }, [bookingId, searchParams, sessionBooking, receiptToken]);

  const walletOptions = WALLET_PAYMENT_OPTIONS.filter((opt) =>
    availableWalletMethods(hotel).includes(opt.id),
  );
  const activeWallet = selectedWallet && walletOptions.some((o) => o.id === selectedWallet)
    ? selectedWallet
    : (walletOptions[0]?.id ?? 'gcash');
  const walletTheme = walletMethodTheme(activeWallet);

  useEffect(() => {
    if (!hotel?.id) {
      setQrObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return undefined;
      });
      return;
    }
    const methods = availableWalletMethods(hotel);
    if (!methods.length) {
      setQrObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return undefined;
      });
      return;
    }

    let objectUrl: string | undefined;
    let cancelled = false;
    const hotelId = hotel.id;
    const method = activeWallet;

    async function loadPaymentQr() {
      setQrLoading(true);
      for (const refresh of [false, true]) {
        if (cancelled) return;
        try {
          const res = await fetch(paymentQrProxyUrl(hotelId, method, refresh));
          if (!res.ok) continue;
          const blob = await res.blob();
          const mime = blob.type || res.headers.get('content-type') || '';
          const looksLikeImage = mime.startsWith('image/')
            || mime === 'application/octet-stream'
            || mime === 'binary/octet-stream'
            || mime === '';
          if (cancelled || blob.size < 32 || !looksLikeImage) continue;
          objectUrl = URL.createObjectURL(blob);
          setQrObjectUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return objectUrl;
          });
          setQrLoading(false);
          return;
        } catch {
          // try refresh on next loop
        }
      }
      if (!cancelled) {
        setQrObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return undefined;
        });
        setQrLoading(false);
      }
    }

    setQrObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return undefined;
    });
    void loadPaymentQr();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hotel, activeWallet]);

  const handleDownload = async () => {
    if (!booking || isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadReceiptPdf(booking);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleUploadProof = async () => {
    if (!booking || !bookingId || !receiptToken || isUploadingProof) return;
    if (!paymentProofFile) {
      showToast({ title: 'Upload your payment screenshot', type: 'error' });
      return;
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(paymentProofFile.type)) {
      showToast({ title: 'Payment proof must be a JPG, PNG, WEBP, or PDF', type: 'error' });
      return;
    }
    if (paymentProofFile.size > 5 * 1024 * 1024) {
      showToast({ title: 'Payment proof must be 5 MB or smaller', type: 'error' });
      return;
    }
    const ref = paymentTransactionRef.replace(/\s+/g, '').trim();
    if (ref.length < 6) {
      showToast({
        title: 'Enter your transaction reference',
        description: 'Copy the GCash/Maya/bank reference from your receipt (at least 6 characters).',
        type: 'error',
      });
      return;
    }

    const depositDue = Number(
      booking.depositAmount
      ?? Math.floor((booking.totalPrice ?? 0) / 2),
    );
    const claimed = Number(paymentProofAmountClaimed || depositDue) || depositDue;

    setIsUploadingProof(true);
    try {
      const updated = await uploadBookingPaymentProof({
        bookingId,
        token: receiptToken,
        paymentProofFile,
        paymentTransactionRef: ref,
        paymentProofAmountClaimed: claimed,
      });
      setBooking(updated);
      setPaymentProofFile(null);
      setPaymentTransactionRef('');
      showToast({
        title: 'Payment proof sent to hotel',
        description: 'Your screenshot is in the hotel app for verification. The deposit is confirmed only after they approve it.',
        type: 'success',
      });
    } catch (err) {
      showToast({
        title: 'Could not submit payment',
        description: errorMessageFromUnknown(err, 'Please try again.'),
        type: 'error',
      });
    } finally {
      setIsUploadingProof(false);
    }
  };

  const paymentDonePreview = Boolean(booking?.paymentProofUploaded);
  const statusPreview = booking?.status ?? '';
  const isConfirmedPreview = ['confirmed', 'reserved', 'booked', 'paid', 'accepted'].includes(statusPreview);
  const showPayPreview = Boolean(booking)
    && !paymentDonePreview
    && (
      isConfirmedPreview
      || (forcePayParam && !['declined', 'cancelled'].includes(statusPreview))
    );

  useEffect(() => {
    if (!showPayPreview || !forcePayParam) return;
    const el = document.getElementById('pay-deposit-section');
    if (!el) return;
    window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [showPayPreview, forcePayParam, booking?.id]);

  if (isLoading && !booking) {
    return <ConfirmationSkeleton />;
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
  const isConfirmed = ['confirmed', 'reserved', 'booked', 'paid', 'accepted'].includes(booking.status);
  const amountPaid = Number(booking.amountPaid ?? 0);
  const depositDue = Number(
    booking.depositAmount
    ?? Math.floor((booking.totalPrice ?? 0) / 2),
  );
  // Deposit is only "done" after proof upload — never from approval ledger alone.
  const paymentDone = Boolean(booking.paymentProofUploaded);
  const forcePay = forcePayParam;
  // Magic pay link always opens the deposit UI until proof is on file (recovers
  // bookings that were wrongly marked paid by the old approval ledger).
  const showPaySection = (isConfirmed && !paymentDone) || (forcePay && !paymentDone && !['declined', 'cancelled'].includes(booking.status));
  const balanceAtCheckout = Number(
    booking.balanceDue
    ?? Math.max(0, (booking.totalPrice ?? 0) - (paymentDone ? amountPaid || depositDue : 0)),
  );

  const paymentLabel = paymentDone
    ? (booking.paymentProofVerified
      ? `Deposit confirmed${booking.paymentTransactionRef ? ` · ref ${booking.paymentTransactionRef}` : ''}`
      : `Proof submitted — awaiting hotel verification${booking.paymentTransactionRef ? ` · ref ${booking.paymentTransactionRef}` : ''}`)
    : isConfirmed
      ? 'Deposit due — pay via hotel QR below'
      : 'No payment yet — wait for hotel confirmation';

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
          <h1 className="text-4xl font-display font-semibold text-brand-dark mb-2">
            {isPending
              ? 'Reservation Request Received'
              : showPaySection
                ? 'Pay Your Deposit'
                : paymentDone && !booking.paymentProofVerified
                  ? 'Proof Submitted — Awaiting Hotel'
                  : paymentDone
                    ? 'Deposit Confirmed'
                    : 'Reservation Updated'}
          </h1>
          <p className="text-brand-dark/70 font-medium text-sm mt-1 max-w-md mx-auto leading-relaxed">
            {isPending
              ? <>We saved your request for <span className="font-bold text-brand-primary">{booking.guestEmail}</span>. Status is <span className="font-bold">{statusLabel(booking.status)}</span>. The hotel will review it and email you a secure pay link when they confirm.</>
              : showPaySection
                ? <>Your stay is confirmed. Scan the hotel QR, pay the deposit, then upload your receipt screenshot below. The hotel must see and verify that image before the deposit is confirmed.</>
                : paymentDone && !booking.paymentProofVerified
                  ? <>Your payment screenshot is with the hotel for review. The deposit is not confirmed until they verify it in their system.</>
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
              { icon: CreditCard, label: 'Payment', value: paymentLabel },
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
              <span className="text-brand-dark/60">
                Room &amp; guests ({booking.nights} night{booking.nights !== 1 ? 's' : ''})
              </span>
              <span>
                ₱{(
                  (booking.totalPrice ?? 0) + (booking.discountAmount ?? 0)
                ).toLocaleString()}
              </span>
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
              <span className="text-brand-primary">
                Half deposit (50%){paymentDone ? (booking.paymentProofVerified ? ' confirmed' : ' — proof submitted') : ' due'}
              </span>
              <span className="text-brand-primary">
                ₱{(paymentDone ? (amountPaid || depositDue) : depositDue).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold">
              <span className="text-brand-dark/60">Balance at hotel check-out</span>
              <span>₱{balanceAtCheckout.toLocaleString()}</span>
            </div>
            <p className="text-[11px] font-bold text-brand-dark/45 pt-1">
              {isPending
                ? 'You will receive a secure email link to pay the deposit after the hotel confirms.'
                : paymentDone && booking.paymentProofVerified
                  ? 'Deposit verified by the hotel. Remaining balance is collected at check-out.'
                  : paymentDone
                    ? 'Your payment screenshot is in the hotel app. Deposit is confirmed only after they verify it.'
                    : 'Scan the hotel QR below to pay the deposit, then upload your receipt screenshot on this page.'}
            </p>
          </div>
        </motion.div>

        {showPaySection && (
          <motion.div
            id="pay-deposit-section"
            initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.55 }}
            className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-6 mb-6 space-y-5 scroll-mt-28"
          >
            <div>
              <h2 className="text-xl font-serif font-bold text-brand-dark flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-brand-primary" />
                Pay deposit · ₱{depositDue.toLocaleString()}
              </h2>
              <p className="mt-1.5 text-sm text-brand-dark/55 leading-relaxed">
                Pay with the hotel QR, then upload your screenshot and transaction reference. Keep this page open — your booking stays linked via the email token.
              </p>
            </div>

            <div className="rounded-2xl border border-brand-primary/12 overflow-hidden bg-white">
              {walletOptions.length > 0 && (
                <div className="p-3 sm:p-5 border-b border-brand-primary/8 bg-brand-background/40">
                  <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wide sm:tracking-[0.2em] text-brand-primary mb-3">
                    Choose wallet
                  </p>
                  <div className={`grid gap-2 ${walletOptions.length === 1 ? 'grid-cols-1 max-w-[14rem]' : walletOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {walletOptions.map((opt) => {
                      const active = activeWallet === opt.id;
                      const theme = walletMethodTheme(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSelectedWallet(opt.id)}
                          className={`min-h-[48px] rounded-xl border-2 px-2 py-3 text-center transition-all touch-manipulation ${
                            active
                              ? `${theme.activeBorder} ${theme.activeBg} ${theme.activeText} shadow-sm`
                              : `${theme.inactiveBorder} bg-white ${theme.inactiveText}`
                          }`}
                        >
                          <span className="block text-[11px] sm:text-sm font-bold">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {qrLoading ? (
                <div className="px-5 py-12 text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: walletTheme.color }} />
                  <p className="mt-3 text-sm text-brand-dark/55">Loading {walletMethodLabel(activeWallet)} QR…</p>
                </div>
              ) : qrObjectUrl ? (
                <div className="px-3 py-5 sm:p-6 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: walletTheme.color }}>
                    Scan with {walletMethodLabel(activeWallet)} · ₱{depositDue.toLocaleString()}
                  </p>
                  <img
                    src={qrObjectUrl}
                    alt={`${walletMethodLabel(activeWallet)} payment QR`}
                    className="mx-auto w-52 h-52 object-contain rounded-xl bg-white p-2 border border-brand-primary/10"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <div className="px-5 py-8 text-center">
                  <p className="font-serif text-lg font-bold text-brand-dark">Payment QR unavailable</p>
                  <p className="mt-2 text-sm text-brand-dark/55 leading-relaxed max-w-md mx-auto">
                    Contact the hotel for deposit instructions, then upload your proof and reference below.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-brand-primary/12 bg-brand-background/50 p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary">After you pay</p>
                  <p className="mt-0.5 text-sm font-bold text-brand-dark">
                    Upload proof &amp; reference <span className="text-red-400">*</span>
                  </p>
                </div>
                <Upload className="w-4 h-4 text-brand-primary/50 shrink-0 mt-1" />
              </div>

              <label
                htmlFor="confirm-payment-proof"
                className={`flex flex-col items-center justify-center w-full p-5 transition-all duration-200 border-2 border-dashed rounded-2xl cursor-pointer ${
                  paymentProofFile
                    ? 'border-brand-success bg-brand-success/5 text-brand-success'
                    : 'border-brand-primary/20 bg-white hover:border-brand-primary/45 text-brand-dark/60'
                }`}
              >
                {paymentProofFile ? (
                  <div className="flex items-center justify-between w-full gap-2 text-sm font-bold">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-5 h-5 text-brand-success shrink-0" />
                      <span className="truncate">{paymentProofFile.name}</span>
                    </div>
                    <span className="text-xs text-brand-primary underline shrink-0">Change</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-1">
                    <Upload className="w-5 h-5 text-brand-primary mb-2" />
                    <p className="text-sm font-bold text-brand-dark">Drop receipt screenshot here</p>
                    <p className="text-[11px] text-brand-dark/45 mt-1">JPG, PNG, WEBP, or PDF · max 5 MB</p>
                  </div>
                )}
                <input
                  id="confirm-payment-proof"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setPaymentProofFile(file);
                    if (!paymentProofAmountClaimed) {
                      setPaymentProofAmountClaimed(String(depositDue));
                    }
                  }}
                  className="hidden"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="confirm-txn-ref" className="field-label">
                    Transaction reference <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="confirm-txn-ref"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={paymentTransactionRef}
                    onChange={(e) => setPaymentTransactionRef(e.target.value)}
                    placeholder="e.g. 1234 5678 9012"
                    className="input-field"
                    maxLength={64}
                  />
                </div>
                <div>
                  <label htmlFor="confirm-amount-claimed" className="field-label">
                    Amount paid <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-dark/40">
                      ₱
                    </span>
                    <input
                      id="confirm-amount-claimed"
                      type="number"
                      min={0}
                      step="0.01"
                      value={paymentProofAmountClaimed || String(depositDue)}
                      onChange={(e) => setPaymentProofAmountClaimed(e.target.value)}
                      className="input-field pl-7"
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isUploadingProof || !paymentProofFile || paymentTransactionRef.trim().length < 6}
                onClick={() => { void handleUploadProof(); }}
                className="btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2 py-3"
              >
                {isUploadingProof
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                  : <><CheckCircle2 className="w-4 h-4" /> Submit payment proof</>}
              </button>

              <div className="flex items-start gap-2.5">
                <Info className="w-4 h-4 text-brand-primary shrink-0 mt-0.5" />
                <p className="text-xs text-brand-dark/55 leading-relaxed">
                  Bookmark or keep the email link — you can return to this page later without an account.
                </p>
              </div>
            </div>
          </motion.div>
        )}

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
