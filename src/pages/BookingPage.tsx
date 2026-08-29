import { useEffect, useState, useTransition } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, CheckCircle2, ShieldCheck, ChevronDown, Users, Globe, Utensils,
  Phone, Mail, User, Calendar, Tag, Info, Smartphone, Upload, QrCode, X, ZoomIn, Download,
} from 'lucide-react';
import { fetchPropertyById, createBookingRequestApi, fetchHotelById } from '../api/propertyService';
import { validatePromoCode, validateMembershipId } from '../services/api';
import { useBookings } from '../contexts/BookingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/ToastProvider';
import type { BookingPaymentMethod, BookingRoomType, Hotel, Property } from '../types';
import { DISCOUNT_OPTIONS, calculateBookingPricing, computeOnlinePaymentDue } from '../lib/bookingFlow';
import { formatRoomLabel } from '../lib/formatRoomLabel';
import { paymentQrProxyUrl, availableWalletMethods, walletMethodLabel, walletMethodTheme, walletPayFromGallerySteps, manualQrSaveInstructions, savePaymentQrImage, WALLET_PAYMENT_OPTIONS, type WalletPaymentMethod } from '../lib/paymentQr';
import { BookingFormSkeleton } from '../components/ui/Skeleton';
import { cacheKey, peekCache } from '../lib/queryCache';
import { format, addDays } from 'date-fns';

// ── Nationality List ──────────────────────────────────────────────────────────
const NATIONALITIES = [
  'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan', 'Argentine',
  'Armenian', 'Australian', 'Austrian', 'Azerbaijani', 'Bahamian', 'Bahraini',
  'Bangladeshi', 'Barbadian', 'Belarusian', 'Belgian', 'Belizean', 'Beninese',
  'Bhutanese', 'Bolivian', 'Bosnian', 'Botswanan', 'Brazilian', 'British',
  'Bruneian', 'Bulgarian', 'Burkinabe', 'Burundian', 'Cambodian', 'Cameroonian',
  'Canadian', 'Cape Verdean', 'Central African', 'Chadian', 'Chilean', 'Chinese',
  'Colombian', 'Comorian', 'Congolese', 'Costa Rican', 'Croatian', 'Cuban',
  'Cypriot', 'Czech', 'Danish', 'Djiboutian', 'Dominican', 'Dutch', 'Ecuadorian',
  'Egyptian', 'Emirati', 'Equatorial Guinean', 'Eritrean', 'Estonian', 'Ethiopian',
  'Fijian', 'Filipino', 'Finnish', 'French', 'Gabonese', 'Gambian', 'Georgian',
  'German', 'Ghanaian', 'Greek', 'Grenadian', 'Guatemalan', 'Guinean', 'Guyanese',
  'Haitian', 'Honduran', 'Hungarian', 'Icelandic', 'Indian', 'Indonesian', 'Iranian',
  'Iraqi', 'Irish', 'Israeli', 'Italian', 'Ivorian', 'Jamaican', 'Japanese',
  'Jordanian', 'Kazakhstani', 'Kenyan', 'Kuwaiti', 'Kyrgyz', 'Laotian', 'Latvian',
  'Lebanese', 'Liberian', 'Libyan', 'Liechtensteinite', 'Lithuanian', 'Luxembourger',
  'Macedonian', 'Malagasy', 'Malawian', 'Malaysian', 'Maldivian', 'Malian',
  'Maltese', 'Mauritanian', 'Mauritian', 'Mexican', 'Moldovan', 'Monacan',
  'Mongolian', 'Montenegrin', 'Moroccan', 'Mozambican', 'Namibian', 'Nepalese',
  'New Zealander', 'Nicaraguan', 'Nigerian', 'Norwegian', 'Omani', 'Pakistani',
  'Palauan', 'Palestinian', 'Panamanian', 'Paraguayan', 'Peruvian', 'Polish',
  'Portuguese', 'Qatari', 'Romanian', 'Russian', 'Rwandan', 'Salvadoran',
  'Saudi', 'Senegalese', 'Serbian', 'Sierra Leonean', 'Singaporean', 'Slovak',
  'Slovenian', 'Somali', 'South African', 'South Korean', 'South Sudanese',
  'Spanish', 'Sri Lankan', 'Sudanese', 'Surinamese', 'Swazi', 'Swedish', 'Swiss',
  'Syrian', 'Taiwanese', 'Tajik', 'Tanzanian', 'Thai', 'Timorese', 'Togolese',
  'Trinidadian', 'Tunisian', 'Turkish', 'Turkmen', 'Ugandan', 'Ukrainian',
  'Uruguayan', 'Uzbek', 'Venezuelan', 'Vietnamese', 'Yemeni', 'Zambian', 'Zimbabwean',
];

const BOOKING_DISCOUNT_OPTIONS = [
  { value: '', label: 'No Discount' },
  ...DISCOUNT_OPTIONS.filter((opt) => opt.value !== 'none').map((opt) => ({
    value: opt.value,
    label: opt.value === 'pwd' ? 'PWD — 20% off' : 'Senior Citizen — 20% off',
  })),
];

const DEFAULT_FOOD_AMENITIES = [
  'Breakfast', 'Lunch', 'Dinner', 'All-Day Dining', 'Welcome Drink',
  'Mini Bar', 'Room Service', 'Poolside Bar', 'Snack Basket',
];

export default function BookingPage() {
  const { propertyId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { appendBooking } = useBookings();
  const { user } = useAuth();
  const { showToast } = useToast();

  const urlCheckIn = searchParams.get('checkIn') ?? format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const urlCheckOut = searchParams.get('checkOut') ?? format(addDays(new Date(), 3), 'yyyy-MM-dd');
  const urlGuests = Number(searchParams.get('guests') ?? 2);

  const [property, setProperty] = useState<Property | null>(() =>
    propertyId ? peekCache<Property>(cacheKey(['property', propertyId])) ?? null : null,
  );
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [isLoading, setIsLoading] = useState(() =>
    !(propertyId && peekCache(cacheKey(['property', propertyId]))),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  // ── Booking Details ─────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [adults, setAdults] = useState(Math.max(1, urlGuests));
  const [children, setChildren] = useState(0);

  const [malePax, setMalePax] = useState(0);
  const [femalePax, setFemalePax] = useState(0);

  const [nationality, setNationality] = useState('Filipino');
  const [validIdFile, setValidIdFile] = useState<File | null>(null);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentTransactionRef, setPaymentTransactionRef] = useState('');
  const [paymentProofAmountClaimed, setPaymentProofAmountClaimed] = useState('');

  const [selectedComplimentary, setSelectedComplimentary] = useState<string[]>([]);

  const [discountType, setDiscountType] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoDiscountAmt, setPromoDiscountAmt] = useState(0);
  const [promoStatus, setPromoStatus] = useState<string | null>(null);
  const [membershipId, setMembershipId] = useState('');
  const [memberDiscountAmt, setMemberDiscountAmt] = useState(0);
  const [memberStatus, setMemberStatus] = useState<string | null>(null);
  const [memberPoints, setMemberPoints] = useState<number | null>(null);

  const [checkIn, setCheckIn] = useState(urlCheckIn);
  const [checkOut, setCheckOut] = useState(urlCheckOut);
  const [qrObjectUrl, setQrObjectUrl] = useState<string>();
  const [qrBlob, setQrBlob] = useState<Blob | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrLightboxOpen, setQrLightboxOpen] = useState(false);
  const [qrSaveSheetOpen, setQrSaveSheetOpen] = useState(false);
  const [isSavingQr, setIsSavingQr] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletPaymentMethod | null>(null);
  const walletOptions = WALLET_PAYMENT_OPTIONS.filter((opt) =>
    availableWalletMethods(hotel).includes(opt.id),
  );
  const activeWallet = selectedWallet && walletOptions.some((o) => o.id === selectedWallet)
    ? selectedWallet
    : (walletOptions[0]?.id ?? 'gcash');
  const walletTheme = walletMethodTheme(activeWallet);
  const paymentMethod: BookingPaymentMethod = walletTheme.bookingMethod;

  // ── Computed Values (must match server calculateBookingPricing) ─────────────
  const roomType = ((property as { roomType?: string; type?: string } | null)?.roomType
    ?? (property as { type?: string } | null)?.type
    ?? 'standard-room') as BookingRoomType;
  const discountReason =
    discountType === 'pwd' || discountType === 'senior citizen' ? discountType : undefined;
  const pricing = property
    ? calculateBookingPricing(property, {
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults,
        children,
        infants: 0,
        roomType,
        paymentMethod,
        discountReason,
      })
    : null;
  const nights = pricing?.nights ?? 1;
  const roomRate = pricing?.roomTotal ?? 0;
  const discountAmt = pricing?.discountAmount ?? 0;
  // Server compares PWD/senior vs promo on the pre-discount subtotal and keeps the larger.
  const staySubtotal = (pricing?.totalPrice ?? 0) + discountAmt;
  const effectiveDiscount = Math.max(discountAmt, promoDiscountAmt, memberDiscountAmt);
  const total = Math.max(0, staySubtotal - effectiveDiscount);
  const paymentMode = 'half' as const;
  const { amountDue, balanceDue, depositPercent } = computeOnlinePaymentDue(total, paymentMode);
  const paymentQrUrl = qrObjectUrl;
  const activeDiscountLabel = memberDiscountAmt >= discountAmt && memberDiscountAmt >= promoDiscountAmt && memberDiscountAmt > 0
    ? 'Madyaw member'
    : promoDiscountAmt >= discountAmt && promoDiscountAmt > 0
      ? 'Promo discount'
      : discountType === 'pwd'
        ? 'PWD Discount (20%)'
        : discountType === 'senior citizen'
          ? 'Senior Citizen Discount (20%)'
          : '';

  // ── Derive food amenities from property ─────────────────────────────────────
  const foodAmenities = (() => {
    const propAmenities: string[] = (property as any)?.amenities ?? [];
    const food = propAmenities.filter(a =>
      DEFAULT_FOOD_AMENITIES.some(f => f.toLowerCase() === a.toLowerCase())
    );
    return food.length > 0 ? food : DEFAULT_FOOD_AMENITIES;
  })();

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    const cachedProperty = peekCache<Property>(cacheKey(['property', propertyId]));
    if (cachedProperty) {
      setProperty(cachedProperty);
      setIsLoading(false);
      if (cachedProperty.hotelId) {
        const cachedHotel = peekCache<Hotel>(cacheKey(['hotel', cachedProperty.hotelId]));
        if (cachedHotel) setHotel(cachedHotel);
      }
    } else {
      setIsLoading(true);
    }

    fetchPropertyById(propertyId)
      .then(async (p) => {
        if (cancelled) return;
        startTransition(() => setProperty(p));
        const hotelId = p.hotelId;
        if (hotelId) {
          try {
            const h = await fetchHotelById(hotelId, { force: true });
            if (!cancelled) startTransition(() => setHotel(h));
          } catch {
            if (!cancelled) setHotel(null);
          }
        } else if (!cancelled) {
          setHotel(null);
        }
        if (!cancelled) setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
        if (!cachedProperty) showToast({ title: 'Unable to load room', type: 'error' });
      });
    return () => { cancelled = true; };
  }, [propertyId]);

  // Prefill from signed-in account (Google-verified email preferred for confirmations).
  useEffect(() => {
    if (!user) return;
    if (user.email) setEmail(prev => prev.trim() ? prev : user.email);
    if (user.name) setFullName(prev => prev.trim() ? prev : user.name);
  }, [user]);

  useEffect(() => {
    if (!hotel?.id) {
      setQrBlob(null);
      setQrObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return undefined;
      });
      return;
    }
    const methods = availableWalletMethods(hotel);
    if (!methods.length) {
      setQrBlob(null);
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
          setQrBlob(blob);
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
        setQrBlob(null);
        setQrObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return undefined;
        });
        setQrLoading(false);
      }
    }

    setQrBlob(null);
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

  useEffect(() => {
    if (!qrLightboxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQrLightboxOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [qrLightboxOpen]);

  useEffect(() => {
    if (!paymentQrUrl) {
      setQrLightboxOpen(false);
      setQrSaveSheetOpen(false);
    }
  }, [paymentQrUrl, activeWallet]);

  useEffect(() => {
    if (!qrSaveSheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQrSaveSheetOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [qrSaveSheetOpen]);

  const isGoogleVerifiedEmail = Boolean(
    user?.email
    && user.emailVerified
    && email.trim().toLowerCase() === user.email.toLowerCase()
    && (user.authProvider === 'google' || user.emailVerified),
  );

  useEffect(() => {
    const code = promoCode.trim();
    if (!code || staySubtotal <= 0) {
      setPromoDiscountAmt(0);
      setPromoStatus(null);
      return;
    }
    setPromoStatus('Checking promo…');
    const timer = window.setTimeout(() => {
      void validatePromoCode(code, staySubtotal).then(result => {
        if (result.valid && typeof result.discountAmount === 'number' && result.discountAmount > 0) {
          setPromoDiscountAmt(result.discountAmount);
          setPromoStatus(`Promo applied — you save ₱${result.discountAmount.toLocaleString()}`);
        } else {
          setPromoDiscountAmt(0);
          setPromoStatus(result.message ?? 'Invalid promo code');
        }
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [promoCode, staySubtotal]);

  useEffect(() => {
    const id = membershipId.trim();
    if (!id || staySubtotal <= 0) {
      setMemberDiscountAmt(0);
      setMemberStatus(null);
      setMemberPoints(null);
      return;
    }
    setMemberStatus('Checking membership…');
    const timer = window.setTimeout(() => {
      void validateMembershipId(id, staySubtotal).then((result) => {
        if (result.valid && typeof result.discountAmount === 'number' && result.discountAmount > 0) {
          setMemberDiscountAmt(result.discountAmount);
          setMemberPoints(typeof result.pointsBalance === 'number' ? result.pointsBalance : null);
          setMemberStatus(result.message ?? `Member discount — you save ₱${result.discountAmount.toLocaleString()}`);
        } else {
          setMemberDiscountAmt(0);
          setMemberPoints(typeof result.pointsBalance === 'number' ? result.pointsBalance : null);
          setMemberStatus(result.message ?? 'Invalid membership ID');
        }
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [membershipId, staySubtotal]);

  const toggleComplimentary = (item: string) => {
    startTransition(() => {
      setSelectedComplimentary((prev) =>
        prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item],
      );
    });
  };

  const requiresPaymentProof = true;

  const isFormValid =
    fullName.trim() &&
    email.trim() &&
    phone.trim() &&
    checkIn &&
    checkOut &&
    new Date(checkOut) > new Date(checkIn) &&
    Boolean(validIdFile) &&
    Boolean(paymentProofFile) &&
    paymentTransactionRef.trim().length >= 6;

  const handleSubmit = async () => {
    if (!property || !propertyId) return;
    if (!fullName.trim() || !email.trim() || !phone.trim() || !checkIn || !checkOut) {
      showToast({ title: 'Please fill in all required personal information and stay dates', type: 'error' });
      return;
    }
    if (!validIdFile) {
      showToast({ title: 'Please upload your valid ID to continue', type: 'error' });
      return;
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(validIdFile.type)) {
      showToast({ title: 'Valid ID must be a JPG, PNG, WEBP, or PDF', type: 'error' });
      return;
    }
    if (validIdFile.size > 5 * 1024 * 1024) {
      showToast({ title: 'Valid ID must be 5 MB or smaller', type: 'error' });
      return;
    }
    if (requiresPaymentProof && !paymentProofFile) {
      showToast({ title: 'Please upload your payment screenshot after paying via the hotel QR', type: 'error' });
      return;
    }
    if (paymentProofFile) {
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
          description: 'Copy the GCash/Maya/bank reference number from your receipt (at least 6 characters).',
          type: 'error',
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // Must match server allowlist: 'pwd' | 'senior citizen'
      const discountReason =
        discountType === 'pwd' || discountType === 'senior citizen' ? discountType : undefined;

      const booking = await createBookingRequestApi({
        propertyId,
        propertyName: formatRoomLabel(property),
        guestName: fullName,
        guestEmail: email,
        guestPhone: phone,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults,
        children,
        infants: 0,
        roomType,
        paymentMethod,
        discountAmount: discountAmt,
        discountReason,
        promoCode: promoCode.trim() || undefined,
        membershipId: membershipId.trim() || undefined,
        validIdFile,
        paymentProofFile: paymentProofFile ?? undefined,
        paymentTransactionRef: paymentProofFile
          ? paymentTransactionRef.replace(/\s+/g, '').trim()
          : undefined,
        paymentProofAmountClaimed: paymentProofFile
          ? Number(paymentProofAmountClaimed || amountDue) || amountDue
          : undefined,
        specialRequests: [
          `Valid ID uploaded: ${validIdFile.name}`,
          paymentProofFile ? `Payment proof uploaded: ${paymentProofFile.name}` : '',
          paymentProofFile
            ? `Txn ref: ${paymentTransactionRef.replace(/\s+/g, '').trim().toUpperCase()}`
            : '',
          nationality !== 'Filipino' ? `Nationality: ${nationality}` : '',
          malePax || femalePax ? `Demographics: ${malePax}M / ${femalePax}F` : '',
          selectedComplimentary.length > 0 ? `Complimentary: ${selectedComplimentary.join(', ')}` : '',
          `Payment: hotel QR (50% deposit)`,
        ].filter(Boolean).join(' | ') || undefined,
      });
      appendBooking(booking);
      const receiptToken = (booking as { receiptToken?: string }).receiptToken;
      const params = new URLSearchParams({ email });
      if (receiptToken) params.set('token', receiptToken);
      navigate(`/booking/confirm/${booking.id}?${params.toString()}`);
    } catch (err: any) {
      const serverMessage = err.response?.data?.message || err.message;
      showToast({ title: 'Booking failed', description: serverMessage || 'Please try again.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading && !property) {
    return <BookingFormSkeleton />;
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-brand-background flex items-center justify-center p-4 pt-32 pb-16">
        <div className="bg-brand-cream rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-serif font-bold text-brand-dark mb-3">Room Not Found</h2>
          <button onClick={() => navigate(-1)} className="btn-primary">Go Back</button>
        </div>
      </div>
    );
  }

  const walletGridClass = walletOptions.length <= 1
    ? 'grid grid-cols-1 max-w-[14rem] mx-auto'
    : walletOptions.length === 2
      ? 'grid grid-cols-2 gap-2'
      : 'grid grid-cols-3 gap-1.5 sm:gap-2';

  const handleSavePaymentQr = async () => {
    if ((!paymentQrUrl && !qrBlob) || isSavingQr) return;
    setIsSavingQr(true);
    try {
      const result = await savePaymentQrImage(qrBlob ?? paymentQrUrl!, {
        method: activeWallet,
        hotelName: hotel?.name,
      });
      if (result === 'manual') {
        setQrSaveSheetOpen(true);
        return;
      }
      if (result === 'failed') {
        showToast({
          title: 'Could not save QR',
          description: 'Use the steps below to save the image manually.',
          type: 'error',
        });
        setQrSaveSheetOpen(true);
        return;
      }
      showToast({
        title: result === 'shared' ? 'QR ready to save' : 'QR saved',
        description: result === 'shared'
          ? `Choose Save image in the share menu, then open ${walletMethodLabel(activeWallet)}.`
          : `Open ${walletMethodLabel(activeWallet)} and upload the QR from your photos.`,
        type: 'success',
      });
    } finally {
      setIsSavingQr(false);
    }
  };

  const manualQrSave = manualQrSaveInstructions();

  const roomLabel = formatRoomLabel(property);

  return (
    <>
    <div className="min-h-screen bg-brand-background pt-32 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-display font-semibold text-brand-dark mb-1">Booking Details</h1>
          <p className="text-brand-dark/60 font-bold text-sm px-2 break-words">{roomLabel}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">

          {/* ── Main Form ─────────────────────────────────────────────────── */}
          <div className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-4 sm:p-6 space-y-7 order-2 lg:order-none">

            {/* Section: Personal Info */}
            <section>
              <h2 className="text-base font-bold uppercase tracking-widest text-brand-primary mb-4 flex items-center gap-2">
                <User className="w-4 h-4" /> Personal Information
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="field-label">Full Name <span className="text-red-400">*</span></label>
                  <input
                    id="booking-fullname"
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Full name as shown on ID"
                    className="input-field"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="field-label">
                      Email Address <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                      <input
                        id="booking-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="yourname@gmail.com"
                        className="input-field !pl-10"
                        readOnly={isGoogleVerifiedEmail}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">
                      {isGoogleVerifiedEmail
                        ? 'Using your Google-verified email — confirmation will be sent here when the hotel approves your stay.'
                        : 'Confirmation is sent to this email when the hotel approves your reservation for check-in. Sign in with Google to use a verified address.'}
                    </p>
                  </div>
                  <div>
                    <label className="field-label">Phone Number <span className="text-red-400">*</span></label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                      <input
                        id="booking-phone"
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="+63 9XX XXX XXXX"
                        className="input-field !pl-10"
                      />
                    </div>
                  </div>
                </div>

                {/* Nationality */}
                <div>
                  <label className="field-label"><Globe className="inline w-3.5 h-3.5 mr-1 text-brand-primary" />Nationality</label>
                  <div className="relative">
                    <select
                      id="booking-nationality"
                      value={nationality}
                      onChange={e => setNationality(e.target.value)}
                      className="input-field appearance-none !pr-10"
                    >
                      {NATIONALITIES.map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                  </div>
                </div>

                {/* Send your valid ID */}
                <div className="pt-2">
                  <label className="field-label flex items-center justify-between">
                    <span><ShieldCheck className="inline w-3.5 h-3.5 mr-1 text-brand-primary" />Send your valid ID <span className="text-red-400">*</span></span>
                    <span className="text-[10px] text-brand-dark/40 font-normal lowercase">Passport, Driver's License, or Gov ID</span>
                  </label>
                  <label
                    htmlFor="booking-valid-id"
                    className={`mt-1 flex flex-col items-center justify-center w-full p-4 transition-all duration-200 border-2 border-dashed rounded-xl cursor-pointer ${
                      validIdFile
                        ? 'border-brand-success bg-brand-success/5 text-brand-success shadow-sm'
                        : 'border-brand-primary/25 bg-brand-background/40 hover:bg-brand-background/70 hover:border-brand-primary/50 text-brand-dark/60'
                    }`}
                  >
                    {validIdFile ? (
                      <div className="flex items-center justify-between w-full gap-2 text-sm font-bold">
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="w-5 h-5 text-brand-success shrink-0" />
                          <span className="truncate">{validIdFile.name}</span>
                          <span className="text-xs font-normal text-brand-dark/50 shrink-0">({(validIdFile.size / 1024).toFixed(0)} KB)</span>
                        </div>
                        <span className="text-xs text-brand-primary underline hover:text-brand-hover shrink-0">Change ID</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center py-2">
                        <Upload className="w-6 h-6 mb-2 text-brand-primary/60" />
                        <p className="text-xs font-bold text-brand-dark">
                          Click to upload or drag & drop your valid ID
                        </p>
                        <p className="text-[10px] text-brand-dark/50 mt-0.5">
                          JPG, PNG, WEBP, or PDF (MAX. 5MB) — stored securely for the hotel
                        </p>
                      </div>
                    )}
                    <input
                      id="booking-valid-id"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
                        if (!allowed.includes(file.type)) {
                          showToast({ title: 'Valid ID must be a JPG, PNG, WEBP, or PDF', type: 'error' });
                          e.target.value = '';
                          return;
                        }
                        if (file.size > 5 * 1024 * 1024) {
                          showToast({ title: 'Valid ID must be 5 MB or smaller', type: 'error' });
                          e.target.value = '';
                          return;
                        }
                        setValidIdFile(file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </section>

            <div className="h-px bg-brand-primary/8" />

            {/* Section: Room Occupancy */}
            <section>
              <h2 className="text-base font-bold uppercase tracking-widest text-brand-primary mb-4 flex items-center gap-2">
                <Users className="w-4 h-4" /> Guests in Room
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Adults</label>
                  <div className="relative">
                    <select
                      id="booking-adults"
                      value={adults}
                      onChange={e => setAdults(Number(e.target.value))}
                      className="input-field appearance-none !pr-10"
                    >
                      {[1,2,3,4,5,6].map(n => (
                        <option key={n} value={n}>{n} Adult{n !== 1 ? 's' : ''}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="field-label">Children</label>
                  <div className="relative">
                    <select
                      id="booking-children"
                      value={children}
                      onChange={e => setChildren(Number(e.target.value))}
                      className="input-field appearance-none !pr-10"
                    >
                      {[0,1,2,3,4].map(n => (
                        <option key={n} value={n}>{n} {n === 1 ? 'Child' : 'Children'}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Demographics */}
              <div className="mt-4">
                <label className="field-label">Demographics — Head Count</label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-brand-dark/50 font-bold block mb-1">Male</label>
                    <input
                      id="booking-male-pax"
                      type="number"
                      min={0}
                      value={malePax}
                      onChange={e => setMalePax(Math.max(0, Number(e.target.value)))}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-brand-dark/50 font-bold block mb-1">Female</label>
                    <input
                      id="booking-female-pax"
                      type="number"
                      min={0}
                      value={femalePax}
                      onChange={e => setFemalePax(Math.max(0, Number(e.target.value)))}
                      className="input-field"
                    />
                  </div>
                </div>
              </div>
            </section>

            <div className="h-px bg-brand-primary/8" />

            {/* Section: Complimentary Items */}
            <section>
              <h2 className="text-base font-bold uppercase tracking-widest text-brand-primary mb-1 flex items-center gap-2">
                <Utensils className="w-4 h-4" /> Complimentary Items
              </h2>
              <p className="text-xs text-brand-dark/50 font-bold mb-3">Select any complimentary dining or beverage items you'd like included.</p>
              <div className="flex flex-wrap gap-2">
                {foodAmenities.map(item => {
                  const selected = selectedComplimentary.includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      id={`complimentary-${item.toLowerCase().replace(/\s+/g, '-')}`}
                      onClick={() => toggleComplimentary(item)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${
                        selected
                          ? 'bg-brand-primary text-white border-brand-primary shadow-sm scale-105'
                          : 'bg-white/60 text-brand-dark/60 border-brand-primary/20 hover:border-brand-primary/50'
                      }`}
                    >
                      {selected && <CheckCircle2 className="inline w-3 h-3 mr-1" />}
                      {item}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="h-px bg-brand-primary/8" />

            {/* Section: Dates & Discount */}
            <section>
              <h2 className="text-base font-bold uppercase tracking-widest text-brand-primary mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Stay Dates & Discount
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Check-in Date <span className="text-red-400">*</span></label>
                  <input
                    id="booking-checkin"
                    type="date"
                    value={checkIn}
                    min={format(new Date(), 'yyyy-MM-dd')}
                    onChange={e => {
                      setCheckIn(e.target.value);
                      if (e.target.value >= checkOut)
                        setCheckOut(format(addDays(new Date(e.target.value), 1), 'yyyy-MM-dd'));
                    }}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="field-label">Check-out Date <span className="text-red-400">*</span></label>
                  <input
                    id="booking-checkout"
                    type="date"
                    value={checkOut}
                    min={checkIn ? format(addDays(new Date(checkIn), 1), 'yyyy-MM-dd') : undefined}
                    onChange={e => setCheckOut(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>

              {/* Discount Dropdown */}
              <div className="mt-4">
                <label className="field-label"><Tag className="inline w-3.5 h-3.5 mr-1 text-brand-primary" />Discount Type</label>
                <div className="relative">
                  <select
                    id="booking-discount"
                    value={discountType}
                    onChange={e => setDiscountType(e.target.value)}
                    className="input-field appearance-none pr-9"
                  >
                    {BOOKING_DISCOUNT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                </div>
                {discountType && (
                  <p className="mt-1.5 text-xs text-brand-success font-bold">
                    ✓ 20% discount applied — you save ₱{discountAmt.toLocaleString()}
                  </p>
                )}
              </div>

              <div className="mt-4">
                <label className="field-label"><Tag className="inline w-3.5 h-3.5 mr-1 text-brand-primary" />Madyaw Membership ID</label>
                <input
                  id="booking-membership"
                  type="text"
                  value={membershipId}
                  onChange={e => setMembershipId(e.target.value.toUpperCase())}
                  placeholder="e.g. SHID-XXXXXXXX"
                  className="input-field uppercase"
                  autoComplete="off"
                />
                <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">
                  Enter your Membership ID to apply the Madyaw member discount. Points wallet discount can be used once per day. Amount depends on your balance and the member rate set in the hotel app.
                </p>
                <Link
                  to="/become-a-member"
                  className="mt-2 inline-block text-sm font-bold text-brand-primary hover:text-brand-hover underline underline-offset-2"
                >
                  Be a member
                </Link>
                {memberStatus && (
                  <p className={`mt-1.5 text-xs font-bold ${memberDiscountAmt > 0 ? 'text-brand-success' : 'text-brand-dark/55'}`}>
                    {memberDiscountAmt > 0 ? '✓ ' : ''}{memberStatus}
                    {memberPoints != null && memberDiscountAmt > 0 ? '' : ''}
                  </p>
                )}
              </div>

              <div className="mt-4">
                <label className="field-label"><Tag className="inline w-3.5 h-3.5 mr-1 text-brand-primary" />Promo Code</label>
                <input
                  id="booking-promo"
                  type="text"
                  value={promoCode}
                  onChange={e => setPromoCode(e.target.value.toUpperCase())}
                  placeholder="Optional promo code"
                  className="input-field uppercase"
                />
                <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">
                  If PWD/senior, promo, and member discounts all apply, the largest discount is used.
                </p>
                {promoStatus && (
                  <p className={`mt-1.5 text-xs font-bold ${promoDiscountAmt > 0 ? 'text-brand-success' : 'text-brand-dark/55'}`}>
                    {promoDiscountAmt > 0 ? '✓ ' : ''}{promoStatus}
                  </p>
                )}
              </div>
            </section>

            <div className="h-px bg-brand-primary/8" />

            {/* Section: Payment — hotel-app QR image only */}
            <section className="space-y-5">
              <div>
                <h2 className="text-base font-bold uppercase tracking-widest text-brand-primary flex items-center gap-2">
                  <Smartphone className="w-4 h-4" /> Half Payment First
                </h2>
                <p className="mt-1.5 text-sm text-brand-dark/55 leading-relaxed">
                  Pay {depositPercent}% now · settle the rest at check-out.
                </p>
              </div>

              <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-2 sm:gap-3">
                <div className="rounded-2xl border-2 border-brand-primary bg-gradient-to-b from-brand-primary/10 to-brand-primary/5 p-3 sm:p-4 text-center min-[400px]:text-left">
                  <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-1">
                    Pay now
                  </p>
                  <p className="font-serif font-bold text-lg sm:text-2xl text-brand-primary tabular-nums">
                    ₱{amountDue.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[10px] font-bold text-brand-primary/70">{depositPercent}% deposit</p>
                </div>
                <div className="rounded-2xl border border-brand-primary/10 bg-brand-background/80 p-3 sm:p-4 text-center min-[400px]:text-left">
                  <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-brand-dark/40 mb-1">
                    Later
                  </p>
                  <p className="font-serif font-bold text-lg sm:text-2xl text-brand-dark tabular-nums">
                    ₱{balanceDue.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[10px] font-bold text-brand-dark/40">At check-out</p>
                </div>
                <div className="rounded-2xl border border-brand-primary/10 bg-brand-background/80 p-3 sm:p-4 text-center min-[400px]:text-left">
                  <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-brand-dark/40 mb-1">
                    Total
                  </p>
                  <p className="font-serif font-bold text-lg sm:text-2xl text-brand-dark tabular-nums">
                    ₱{total.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[10px] font-bold text-brand-dark/40">Full stay</p>
                </div>
              </div>

              <div className="rounded-2xl border border-brand-primary/12 overflow-hidden bg-white">
                {walletOptions.length > 0 && (
                  <div className="p-3 sm:p-5 border-b border-brand-primary/8 bg-brand-background/40">
                    <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wide sm:tracking-[0.2em] text-brand-primary mb-3 text-center sm:text-left">
                      Choose how to pay online
                    </p>
                    <div className={walletGridClass}>
                      {walletOptions.map((opt) => {
                        const active = activeWallet === opt.id;
                        const theme = walletMethodTheme(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setSelectedWallet(opt.id)}
                            className={`min-h-[48px] rounded-xl border-2 px-2 py-3 sm:py-3.5 text-center transition-all touch-manipulation active:scale-[0.98] ${
                              active
                                ? `${theme.activeBorder} ${theme.activeBg} ${theme.activeText} shadow-sm ring-2 ring-offset-0 sm:ring-offset-1`
                                : `${theme.inactiveBorder} bg-white ${theme.inactiveText} ${theme.hoverBorder}`
                            }`}
                            style={active ? { boxShadow: `0 0 0 3px ${theme.color}22` } : undefined}
                          >
                            <span className="block text-[11px] sm:text-sm font-bold leading-tight">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {qrLoading ? (
                  <div className="px-5 py-12 sm:px-8 text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: walletTheme.color }} />
                    <p className="mt-3 text-sm text-brand-dark/55">Loading {walletMethodLabel(activeWallet)} QR…</p>
                  </div>
                ) : paymentQrUrl ? (
                  <div
                    className="px-3 py-5 sm:p-6 text-center"
                    style={{ background: `radial-gradient(ellipse at top, ${walletTheme.color}14, transparent 65%)` }}
                  >
                    <p
                      className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wide sm:tracking-[0.2em] mb-4 px-1 leading-relaxed"
                      style={{ color: walletTheme.color }}
                    >
                      <span className="block sm:inline">Scan with {walletMethodLabel(activeWallet)}</span>
                      <span className="hidden sm:inline"> · </span>
                      <span className="block sm:inline tabular-nums">₱{amountDue.toLocaleString()}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setQrLightboxOpen(true)}
                      className="group inline-flex w-full max-w-[min(100%,16rem)] sm:max-w-none sm:w-auto flex-col items-center rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 mx-auto"
                      style={{ ['--tw-ring-color' as string]: walletTheme.color }}
                      aria-label={`Enlarge ${walletMethodLabel(activeWallet)} payment QR`}
                    >
                      <div
                        className="relative inline-flex w-full justify-center rounded-2xl bg-white p-2.5 sm:p-3 border shadow-sm transition-transform group-hover:scale-[1.02] group-active:scale-[0.98]"
                        style={{ borderColor: `${walletTheme.color}33` }}
                      >
                        <img
                          src={paymentQrUrl}
                          alt={`${walletMethodLabel(activeWallet)} payment QR`}
                          className="w-full max-w-[11rem] sm:max-w-none sm:w-56 sm:h-56 aspect-square object-contain"
                          referrerPolicy="no-referrer"
                        />
                        <span
                          className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-brand-dark/80 px-2 py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wide text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 pointer-events-none"
                        >
                          <ZoomIn className="h-3 w-3 shrink-0" />
                          <span className="hidden sm:inline">Tap to enlarge</span>
                          <span className="sm:hidden">Enlarge</span>
                        </span>
                      </div>
                    </button>
                    <div className="mt-4 flex flex-col items-center gap-3 max-w-sm mx-auto px-1">
                      <button
                        type="button"
                        onClick={() => { void handleSavePaymentQr(); }}
                        disabled={isSavingQr}
                        className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl border-2 px-5 py-3 text-sm font-bold transition-all touch-manipulation disabled:opacity-60"
                        style={{
                          borderColor: walletTheme.color,
                          color: walletTheme.color,
                          backgroundColor: `${walletTheme.color}10`,
                        }}
                      >
                        {isSavingQr ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 shrink-0" />
                        )}
                        {isSavingQr ? 'Saving…' : 'Save QR to phone'}
                      </button>
                      <div className="w-full rounded-xl border border-brand-primary/10 bg-white/80 p-3 sm:p-4 text-left">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/45 mb-2">
                          Paying on this phone?
                        </p>
                        <ol className="space-y-1.5 text-xs text-brand-dark/60 leading-relaxed list-decimal list-inside">
                          {walletPayFromGallerySteps(activeWallet, amountDue).map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                      <p className="text-xs text-brand-dark/45 leading-relaxed text-center">
                        On another device? Tap the QR to enlarge and scan with your camera.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-8 sm:px-8 sm:py-10 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-primary/8 text-brand-primary">
                      <QrCode className="h-7 w-7" strokeWidth={1.5} />
                    </div>
                    <p className="font-serif text-lg font-bold text-brand-dark">
                      Payment QR unavailable
                    </p>
                    <p className="mt-2 text-sm text-brand-dark/55 leading-relaxed max-w-md mx-auto">
                      {hotel?.hasPaymentQr
                        ? 'The hotel’s QR isn’t loading right now. You can still submit this request — they’ll send payment instructions after review.'
                        : 'This hotel hasn’t published a payment QR yet. Submit your request and they’ll share how to pay the deposit.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-brand-primary/12 bg-brand-background/50 p-4 sm:p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary">
                      After you pay
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-brand-dark">
                      Upload proof &amp; reference <span className="text-red-400">*</span>
                    </p>
                  </div>
                  <Upload className="w-4 h-4 text-brand-primary/50 shrink-0 mt-1" />
                </div>

                <label
                  htmlFor="booking-payment-proof"
                  className={`flex flex-col items-center justify-center w-full p-5 transition-all duration-200 border-2 border-dashed rounded-2xl cursor-pointer ${
                    paymentProofFile
                      ? 'border-brand-success bg-brand-success/5 text-brand-success'
                      : 'border-brand-primary/20 bg-white hover:border-brand-primary/45 hover:bg-white text-brand-dark/60'
                  }`}
                >
                  {paymentProofFile ? (
                    <div className="flex items-center justify-between w-full gap-2 text-sm font-bold">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="w-5 h-5 text-brand-success shrink-0" />
                        <span className="truncate">{paymentProofFile.name}</span>
                        <span className="text-xs font-normal text-brand-dark/50 shrink-0">
                          ({(paymentProofFile.size / 1024).toFixed(0)} KB)
                        </span>
                      </div>
                      <span className="text-xs text-brand-primary underline hover:text-brand-hover shrink-0">Change</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-1">
                      <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/8">
                        <Upload className="w-5 h-5 text-brand-primary" />
                      </div>
                      <p className="text-sm font-bold text-brand-dark">
                        Drop receipt screenshot here
                      </p>
                      <p className="text-[11px] text-brand-dark/45 mt-1 max-w-xs">
                        GCash, Maya, or bank transfer · JPG, PNG, WEBP, or PDF · max 5 MB
                      </p>
                    </div>
                  )}
                  <input
                    id="booking-payment-proof"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
                      if (!allowed.includes(file.type)) {
                        showToast({ title: 'Payment proof must be a JPG, PNG, WEBP, or PDF', type: 'error' });
                        e.target.value = '';
                        return;
                      }
                      if (file.size > 5 * 1024 * 1024) {
                        showToast({ title: 'Payment proof must be 5 MB or smaller', type: 'error' });
                        e.target.value = '';
                        return;
                      }
                      setPaymentProofFile(file);
                      if (!paymentProofAmountClaimed) {
                        setPaymentProofAmountClaimed(String(amountDue));
                      }
                    }}
                    className="hidden"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label htmlFor="payment-txn-ref" className="field-label">
                        Transaction reference <span className="text-red-400">*</span>
                      </label>
                      <input
                        id="payment-txn-ref"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={paymentTransactionRef}
                        onChange={(e) => setPaymentTransactionRef(e.target.value)}
                        placeholder="e.g. 1234 5678 9012"
                        className="input-field"
                        maxLength={64}
                      />
                      <p className="mt-1.5 text-[11px] text-brand-dark/45">
                        Copy from your wallet or bank receipt
                      </p>
                    </div>
                    <div>
                      <label htmlFor="payment-amount-claimed" className="field-label">
                        Amount paid <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-dark/40">
                          ₱
                        </span>
                        <input
                          id="payment-amount-claimed"
                          type="number"
                          min={0}
                          step="0.01"
                          value={paymentProofAmountClaimed || String(amountDue)}
                          onChange={(e) => setPaymentProofAmountClaimed(e.target.value)}
                          className="input-field pl-7"
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-brand-dark/45">
                        Must match ₱{amountDue.toLocaleString()} deposit
                      </p>
                    </div>
                  </div>
              </div>

              <div className="flex items-start gap-2.5 px-1">
                <Info className="w-4 h-4 text-brand-primary shrink-0 mt-0.5" />
                <p className="text-xs text-brand-dark/55 leading-relaxed">
                  The hotel verifies your deposit before confirming. Remaining{' '}
                  <span className="font-bold text-brand-dark">₱{balanceDue.toLocaleString()}</span> is paid at check-out.
                </p>
              </div>
            </section>

            {/* Security Note */}
            <div className="flex items-center gap-2 text-xs font-bold text-brand-dark/50 bg-brand-primary/5 rounded-xl p-3">
              <Info className="w-4 h-4 text-brand-primary shrink-0" />
              Your stay is submitted as a reservation request. The hotel will review it in their management system and contact you at the email you provide.
            </div>

            {/* Submit */}
            <button
              id="booking-submit"
              type="button"
              disabled={isSubmitting || !isFormValid}
              onClick={handleSubmit}
              className="btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2 py-4 text-base"
            >
              {isSubmitting
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                : <><ShieldCheck className="w-5 h-5" /> Submit Reservation Request</>
              }
            </button>
          </div>

          {/* ── Booking Summary Sidebar ────────────────────────────────────── */}
          <aside className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-4 sm:p-6 space-y-4 h-fit lg:sticky lg:top-24 order-1 lg:order-none">
            <h3 className="font-serif font-bold text-lg text-brand-dark">Booking Summary</h3>

            {((property as any).imageUrl ?? property.image) && (
              <img
                src={(property as any).imageUrl ?? property.image}
                alt={roomLabel}
                className="w-full h-36 object-cover rounded-xl"
                onError={e => { (e.target as HTMLImageElement).src = '/hero/slide-1.jpg'; }}
              />
            )}

            <div className="space-y-1">
              <p className="font-serif font-bold text-brand-dark">
                {roomLabel}
              </p>
              {(property.hotelLocation || property.location) && (
                <p className="text-brand-dark/60 font-bold text-xs">
                  {property.hotelLocation || property.location}
                </p>
              )}
            </div>

            <div className="border-t border-brand-primary/8 pt-3 space-y-2">
              <div className="flex justify-between text-sm font-bold">
                <span className="text-brand-dark/60">Check-in</span>
                <span className="text-brand-dark">{checkIn}</span>
              </div>
              <div className="flex justify-between text-sm font-bold">
                <span className="text-brand-dark/60">Check-out</span>
                <span className="text-brand-dark">{checkOut}</span>
              </div>
              <div className="flex justify-between text-sm font-bold">
                <span className="text-brand-dark/60">Duration</span>
                <span className="text-brand-dark">{nights} night{nights !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex justify-between text-sm font-bold">
                <span className="text-brand-dark/60">Guests</span>
                <span className="text-brand-dark">{adults + children} guest{adults + children !== 1 ? 's' : ''}</span>
              </div>
              {selectedComplimentary.length > 0 && (
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-brand-dark/60">Complimentary</span>
                  <span className="text-brand-dark text-right text-xs max-w-[140px] leading-tight">
                    {selectedComplimentary.join(', ')}
                  </span>
                </div>
              )}
            </div>

            <div className="border-t border-brand-primary/8 pt-3 space-y-2">
              <div className="flex justify-between text-sm font-bold">
                <span className="text-brand-dark/60">Room rate ({nights} nights)</span>
                <span className="text-brand-dark">₱{roomRate.toLocaleString()}</span>
              </div>
              {effectiveDiscount > 0 && (
                <div className="flex justify-between text-sm font-bold text-brand-success">
                  <span>{activeDiscountLabel || 'Discount'}</span>
                  <span>−₱{effectiveDiscount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-serif font-bold text-lg border-t border-brand-primary/8 pt-3">
                <span className="text-brand-dark">Stay total</span>
                <span className="text-brand-dark">₱{total.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-1">
                <span className="text-brand-primary">Half deposit (50%)</span>
                <span className="text-brand-primary">₱{amountDue.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-bold">
                <span className="text-brand-dark/60">Balance at hotel check-out</span>
                <span className="text-brand-dark">₱{balanceDue.toLocaleString()}</span>
              </div>
            </div>

            <p className="flex items-center gap-2 text-[10px] text-brand-dark/40 font-bold">
              <ShieldCheck className="w-3.5 h-3.5 text-brand-success" />
              {(property as any).freeCancellation ? 'Free cancellation · ' : ''}
              Half payment via hotel QR — balance at check-out
            </p>
          </aside>

        </div>
      </div>
    </div>

    {qrSaveSheetOpen && paymentQrUrl && (
      <div
        className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-brand-dark/90 p-3 sm:p-4 backdrop-blur-sm overscroll-contain"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
        }}
        onClick={() => setQrSaveSheetOpen(false)}
        role="dialog"
        aria-modal="true"
        aria-label="Save payment QR to your phone"
      >
        <button
          type="button"
          className="absolute flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full p-2 text-brand-cream hover:bg-white/10 touch-manipulation"
          style={{
            top: 'max(0.75rem, env(safe-area-inset-top))',
            right: 'max(0.75rem, env(safe-area-inset-right))',
          }}
          onClick={() => setQrSaveSheetOpen(false)}
          aria-label="Close save QR instructions"
        >
          <X className="h-7 w-7 sm:h-8 sm:w-8" />
        </button>
        <div
          className="w-full max-w-[min(100%,28rem)] max-h-[min(92dvh,40rem)] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white p-4 sm:p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p
            className="mb-2 text-center text-sm font-bold text-brand-dark"
          >
            {manualQrSave.title}
          </p>
          <ol className="mb-4 space-y-1.5 text-xs text-brand-dark/65 leading-relaxed list-decimal list-inside px-1">
            {manualQrSave.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <img
            src={paymentQrUrl}
            alt={`${walletMethodLabel(activeWallet)} payment QR — press and hold to save`}
            className="mx-auto w-full max-w-[min(90vw,24rem)] aspect-square object-contain rounded-xl border border-brand-primary/10 bg-white select-none touch-manipulation"
            referrerPolicy="no-referrer"
            draggable={false}
          />
          <p className="mt-3 text-center text-[11px] text-brand-dark/50 px-2">
            Press and hold the image above, then choose Save or Add to Photos.
          </p>
          <button
            type="button"
            onClick={() => { void handleSavePaymentQr(); }}
            disabled={isSavingQr}
            className="mt-4 flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-bold touch-manipulation disabled:opacity-60"
            style={{
              borderColor: walletTheme.color,
              color: walletTheme.color,
              backgroundColor: `${walletTheme.color}10`,
            }}
          >
            {isSavingQr ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isSavingQr ? 'Opening share…' : 'Try Share / Save again'}
          </button>
          <button
            type="button"
            onClick={() => setQrSaveSheetOpen(false)}
            className="mt-3 w-full min-h-[48px] rounded-xl border border-brand-primary/15 bg-brand-background text-sm font-bold text-brand-dark touch-manipulation"
          >
            Done
          </button>
        </div>
      </div>
    )}

    {qrLightboxOpen && paymentQrUrl && (
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-brand-dark/90 p-3 sm:p-4 backdrop-blur-sm overscroll-contain"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
        }}
        onClick={() => setQrLightboxOpen(false)}
        role="dialog"
        aria-modal="true"
        aria-label={`${walletMethodLabel(activeWallet)} payment QR enlarged`}
      >
        <button
          type="button"
          className="absolute flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full p-2 text-brand-cream hover:bg-white/10 touch-manipulation"
          style={{
            top: 'max(0.75rem, env(safe-area-inset-top))',
            right: 'max(0.75rem, env(safe-area-inset-right))',
          }}
          onClick={() => setQrLightboxOpen(false)}
          aria-label="Close enlarged QR"
        >
          <X className="h-7 w-7 sm:h-8 sm:w-8" />
        </button>
        <div
          className="w-full max-w-[min(100%,28rem)] max-h-[min(92dvh,36rem)] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white p-4 sm:p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p
            className="mb-3 sm:mb-4 text-center text-[9px] sm:text-[10px] font-bold uppercase tracking-wide sm:tracking-[0.2em] leading-relaxed px-1"
            style={{ color: walletTheme.color }}
          >
            <span className="block sm:inline">{walletMethodLabel(activeWallet)}</span>
            <span className="hidden sm:inline"> · </span>
            <span className="block sm:inline tabular-nums">₱{amountDue.toLocaleString()}</span>
          </p>
          <img
            src={paymentQrUrl}
            alt={`${walletMethodLabel(activeWallet)} payment QR enlarged`}
            className="mx-auto w-full max-w-[min(85vw,22rem)] aspect-square object-contain"
            referrerPolicy="no-referrer"
          />
          <p className="mt-3 sm:mt-4 text-center text-xs text-brand-dark/55 px-2">
            Scan with {walletMethodLabel(activeWallet)} to pay your deposit
          </p>
          <button
            type="button"
            onClick={() => { void handleSavePaymentQr(); }}
            disabled={isSavingQr}
            className="mt-4 flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-bold touch-manipulation disabled:opacity-60 sm:mt-3"
            style={{
              borderColor: walletTheme.color,
              color: walletTheme.color,
              backgroundColor: `${walletTheme.color}10`,
            }}
          >
            {isSavingQr ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isSavingQr ? 'Saving…' : 'Save QR to phone'}
          </button>
          <button
            type="button"
            onClick={() => setQrLightboxOpen(false)}
            className="mt-3 w-full min-h-[48px] rounded-xl border border-brand-primary/15 bg-brand-background text-sm font-bold text-brand-dark sm:hidden touch-manipulation"
          >
            Close
          </button>
        </div>
      </div>
    )}
    </>
  );
}
