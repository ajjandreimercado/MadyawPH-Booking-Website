import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, CheckCircle2, ShieldCheck, ChevronDown, Users, Globe, Utensils,
  Phone, Mail, User, Calendar, Tag, Info, Smartphone, Upload, CreditCard, Landmark
} from 'lucide-react';
import { fetchPropertyById, createBookingRequestApi, fetchHotelById } from '../api/propertyService';
import { validatePromoCode, validateMembershipId } from '../services/api';
import { useBookings } from '../contexts/BookingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/ToastProvider';
import type { BookingPaymentMethod, BookingRoomType, Hotel, Property } from '../types';
import { DISCOUNT_OPTIONS, PAYMENT_METHOD_OPTIONS, calculateBookingPricing, computeOnlinePaymentDue } from '../lib/bookingFlow';
import { formatRoomLabel } from '../lib/formatRoomLabel';
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

const PAYMENT_METHODS: { id: BookingPaymentMethod; label: string; icon: typeof Smartphone }[] = [
  { id: 'gcash', label: PAYMENT_METHOD_OPTIONS.gcash.label, icon: Smartphone },
  { id: 'maya', label: PAYMENT_METHOD_OPTIONS.maya.label, icon: Smartphone },
  { id: 'credit-card', label: PAYMENT_METHOD_OPTIONS['credit-card'].label, icon: CreditCard },
  { id: 'debit-card', label: PAYMENT_METHOD_OPTIONS['debit-card'].label, icon: CreditCard },
  { id: 'bank-transfer', label: PAYMENT_METHOD_OPTIONS['bank-transfer'].label, icon: Landmark },
];

// ── Food amenities that can be selected as complimentary ──────────────────────
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

  const [property, setProperty] = useState<Property | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const [paymentMethod, setPaymentMethod] = useState<BookingPaymentMethod>('gcash');

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
  const paymentMode = hotel?.onlinePaymentMode === 'full' ? 'full' : 'half';
  const { amountDue, balanceDue, depositPercent } = computeOnlinePaymentDue(total, paymentMode);
  const isFullPayment = paymentMode === 'full';
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
    setIsLoading(true);
    fetchPropertyById(propertyId)
      .then(async (p) => {
        setProperty(p);
        const hotelId = p.hotelId;
        if (hotelId) {
          try {
            const h = await fetchHotelById(hotelId);
            setHotel(h);
          } catch {
            setHotel(null);
          }
        } else {
          setHotel(null);
        }
        setIsLoading(false);
      })
      .catch(() => { setIsLoading(false); showToast({ title: 'Unable to load room', type: 'error' }); });
  }, [propertyId]);

  // Prefill from signed-in account (Google-verified email preferred for confirmations).
  useEffect(() => {
    if (!user) return;
    if (user.email) setEmail(prev => prev.trim() ? prev : user.email);
    if (user.name) setFullName(prev => prev.trim() ? prev : user.name);
  }, [user]);

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
    setSelectedComplimentary(prev =>
      prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]
    );
  };

  const isFormValid =
    fullName.trim() &&
    email.trim() &&
    phone.trim() &&
    checkIn &&
    checkOut &&
    new Date(checkOut) > new Date(checkIn) &&
    Boolean(validIdFile);

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
        specialRequests: [
          `Valid ID uploaded: ${validIdFile.name}`,
          nationality !== 'Filipino' ? `Nationality: ${nationality}` : '',
          malePax || femalePax ? `Demographics: ${malePax}M / ${femalePax}F` : '',
          selectedComplimentary.length > 0 ? `Complimentary: ${selectedComplimentary.join(', ')}` : '',
          `Preferred payment: ${paymentMethod}`,
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-brand-background flex items-center justify-center pt-32 pb-16">
        <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
      </div>
    );
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

  const roomLabel = formatRoomLabel(property);

  return (
    <div className="min-h-screen bg-brand-background pt-32 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark mb-1">Booking Details</h1>
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

            {/* Section: Payment Method */}
            <section>
              <h2 className="text-base font-bold uppercase tracking-widest text-brand-primary mb-4 flex items-center gap-2">
                <Smartphone className="w-4 h-4" /> {isFullPayment ? 'Full Payment' : 'Half Payment First'}
              </h2>
              <p className="text-xs text-brand-dark/50 font-bold mb-3">
                {isFullPayment
                  ? 'This hotel requires the full stay amount for online bookings. Online card capture is optional when available.'
                  : 'Your request includes a 50% deposit amount for the hotel ledger. Online card capture is optional when available; the remaining balance is paid at hotel check-out.'}
              </p>
              <div className={`mb-4 grid grid-cols-1 ${isFullPayment ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-3`}>
                <div className="rounded-xl border-2 border-brand-primary bg-brand-primary/5 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-1">
                    {isFullPayment ? 'Full payment (100%)' : `Half deposit (${depositPercent}%)`}
                  </p>
                  <p className="font-serif font-bold text-xl text-brand-primary">₱{amountDue.toLocaleString()}</p>
                </div>
                {!isFullPayment && (
                  <div className="rounded-xl border border-brand-primary/15 bg-brand-background/60 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/45 mb-1">Balance at check-out</p>
                    <p className="font-serif font-bold text-xl text-brand-dark">₱{balanceDue.toLocaleString()}</p>
                  </div>
                )}
                <div className="rounded-xl border border-brand-primary/15 bg-brand-background/60 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/45 mb-1">Stay total</p>
                  <p className="font-serif font-bold text-xl text-brand-dark">₱{total.toLocaleString()}</p>
                </div>
              </div>
              <p className="text-xs text-brand-dark/50 font-bold mb-3">
                Preferred payment method for the {isFullPayment ? 'full stay payment' : 'half deposit'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PAYMENT_METHODS.map(method => (
                  <button
                    key={method.id}
                    id={`payment-${method.id}`}
                    type="button"
                    onClick={() => setPaymentMethod(method.id)}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all min-w-0 ${
                      paymentMethod === method.id
                        ? 'border-brand-primary bg-brand-primary/5 shadow-sm'
                        : 'border-brand-primary/15 hover:border-brand-primary/40'
                    }`}
                  >
                    <method.icon className={`w-5 h-5 shrink-0 ${paymentMethod === method.id ? 'text-brand-primary' : 'text-brand-dark/40'}`} />
                    <span className={`font-bold text-sm truncate ${paymentMethod === method.id ? 'text-brand-primary' : 'text-brand-dark'}`}>
                      {method.label}
                    </span>
                    {paymentMethod === method.id && <CheckCircle2 className="w-4 h-4 text-brand-primary ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="mt-4 p-4 rounded-xl bg-brand-primary/5 border border-brand-primary/15 flex items-start gap-2">
                <Info className="w-4 h-4 text-brand-primary shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-brand-dark/70 leading-relaxed">
                  {isFullPayment
                    ? `Submitting this request tells the hotel a full payment of ₱${amountDue.toLocaleString()} applies to your stay (ledger preference — not an automatic card charge on submit).`
                    : `Submitting this request tells the hotel a 50% deposit of ₱${amountDue.toLocaleString()} applies to your stay (ledger preference — not an automatic card charge on submit). The remaining ₱${balanceDue.toLocaleString()} is collected at hotel check-out.`}
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
                <span className="text-brand-primary">
                  {isFullPayment ? 'Full payment (100%)' : 'Half deposit (50%)'}
                </span>
                <span className="text-brand-primary">₱{amountDue.toLocaleString()}</span>
              </div>
              {!isFullPayment && (
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-brand-dark/60">Balance at hotel check-out</span>
                  <span className="text-brand-dark">₱{balanceDue.toLocaleString()}</span>
                </div>
              )}
            </div>

            <p className="flex items-center gap-2 text-[10px] text-brand-dark/40 font-bold">
              <ShieldCheck className="w-3.5 h-3.5 text-brand-success" />
              {(property as any).freeCancellation ? 'Free cancellation · ' : ''}
              {isFullPayment ? 'Full payment required by this hotel' : 'Half payment only — balance at check-out'}
            </p>
          </aside>

        </div>
      </div>
    </div>
  );
}
