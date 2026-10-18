import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, CheckCircle2, ShieldCheck, ChevronDown, Globe,
  Phone, Mail, User, Tag, Upload, Clock, MessageSquare, Wallet, Pencil,
} from 'lucide-react';
import { fetchPropertyById, createBookingRequestApi } from '../api/propertyService';
import { quoteStay, validatePromoCode, validateMembershipId, type StayQuote } from '../services/api';
import { useBookings } from '../contexts/BookingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/ToastProvider';
import type { BookingPaymentMethod, BookingRoomType, Property } from '../types';
import { DISCOUNT_OPTIONS } from '../lib/bookingFlow';
import { formatRoomLabel } from '../lib/formatRoomLabel';
import { BookingFormSkeleton } from '../components/ui/Skeleton';
import { cacheKey, peekCache } from '../lib/queryCache';
import { errorMessageFromUnknown } from '../lib/apiError';
import { describeGuests, formatStayDate, peso, readStay, stayQuery } from '../lib/stayParams';
import {
  buildSpecialRequests, clearDraft, getValidId, loadDraft, saveDraft, setValidId, type CheckoutDraft,
} from '../lib/checkoutDraft';
import CheckoutSummary, { CheckoutProgress } from '../components/booking/CheckoutSummary';

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

const ARRIVAL_TIMES = [
  '2:00 PM – 3:00 PM', '3:00 PM – 4:00 PM', '4:00 PM – 5:00 PM', '5:00 PM – 6:00 PM',
  '6:00 PM – 7:00 PM', '7:00 PM – 8:00 PM', '8:00 PM – 9:00 PM', '9:00 PM – 10:00 PM',
  '10:00 PM – 11:00 PM', '11:00 PM – 12:00 AM', 'After midnight',
];

const VALID_ID_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function missingDetails(draft: CheckoutDraft, validIdFile: File | null): string | null {
  if (!draft.fullName.trim()) return 'Enter your full name.';
  if (!EMAIL_RE.test(draft.email.trim())) return 'Enter a valid email address.';
  if (!draft.phone.trim()) return 'Enter your phone number.';
  if (draft.bookingForSomeoneElse && !draft.stayGuestName.trim()) return 'Enter the name of the guest who will stay.';
  if (!validIdFile) return 'Upload your valid ID.';
  return null;
}

/**
 * Checkout in two steps, like Booking.com:
 *   /booking/:propertyId         → (1) Your details
 *   /booking/:propertyId/finish  → (2) Finish booking (review, terms, Complete booking)
 * Dates and guests come from the URL; typed details persist in sessionStorage.
 */
export default function BookingPage({ step = 'details' }: { step?: 'details' | 'finish' }) {
  const { propertyId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { appendBooking } = useBookings();
  const { user } = useAuth();
  const { showToast } = useToast();
  const stay = readStay(searchParams);
  const query = stayQuery(stay);

  const [property, setProperty] = useState<Property | null>(() =>
    propertyId ? peekCache<Property>(cacheKey(['property', propertyId])) ?? null : null,
  );
  const [isLoading, setIsLoading] = useState(() =>
    !(propertyId && peekCache(cacheKey(['property', propertyId]))),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [, startTransition] = useTransition();

  const [draft, setDraft] = useState<CheckoutDraft>(() => loadDraft(propertyId));
  const update = (patch: Partial<CheckoutDraft>) => setDraft((prev) => {
    const next = { ...prev, ...patch };
    saveDraft(propertyId, next);
    return next;
  });
  const [validIdFile, setValidIdFileState] = useState<File | null>(() => getValidId(propertyId));
  const changeValidId = (file: File | null) => {
    setValidId(propertyId, file);
    setValidIdFileState(file);
  };

  const [promoDiscountAmt, setPromoDiscountAmt] = useState(0);
  const [promoStatus, setPromoStatus] = useState<string | null>(null);
  const [memberDiscountAmt, setMemberDiscountAmt] = useState(0);
  const [memberStatus, setMemberStatus] = useState<string | null>(null);

  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const paymentMethod: BookingPaymentMethod = 'gcash';
  const roomType = (property?.type || 'standard-room') as BookingRoomType;
  const discountReason = draft.discountType === 'pwd' || draft.discountType === 'senior citizen' ? draft.discountType : undefined;
  // Only codes the server already accepted go into the price quote, so a typo can't block pricing.
  const appliedPromo = promoDiscountAmt > 0 ? draft.promoCode.trim() : undefined;
  const appliedMember = memberDiscountAmt > 0 ? draft.membershipId.trim() : undefined;
  const stayPrice = quote?.stayPrice ?? 0;

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    const cachedProperty = peekCache<Property>(cacheKey(['property', propertyId]));
    if (cachedProperty) {
      setProperty(cachedProperty);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    fetchPropertyById(propertyId)
      .then((p) => {
        if (cancelled) return;
        startTransition(() => setProperty(p));
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
        if (!cachedProperty) showToast({ title: 'Unable to load room', type: 'error' });
      });
    return () => { cancelled = true; };
  }, [propertyId]);

  // Prefill from a signed-in account (staff testing); guests type their own details.
  useEffect(() => {
    if (!user) return;
    setDraft((prev) => {
      const next = { ...prev, email: prev.email.trim() ? prev.email : user.email ?? "", fullName: prev.fullName.trim() ? prev.fullName : user.name ?? "" };
      saveDraft(propertyId, next);
      return next;
    });
  }, [user]);

  // Server price for this stay — the same numbers the booking will be saved with.
  useEffect(() => {
    if (!property) return;
    let cancelled = false;
    setQuoteLoading(true);
    const timer = window.setTimeout(() => {
      quoteStay({
        propertyId,
        checkInDate: stay.checkIn,
        checkOutDate: stay.checkOut,
        adults: stay.adults,
        children: stay.children,
        roomType,
        discountReason,
        promoCode: appliedPromo,
        membershipId: appliedMember,
      })
        .then((result) => {
          if (cancelled) return;
          setQuote(result);
          setQuoteError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setQuoteError(errorMessageFromUnknown(err, 'We could not price this stay. Please try again.'));
        })
        .finally(() => { if (!cancelled) setQuoteLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [property, propertyId, stay.checkIn, stay.checkOut, stay.adults, stay.children, roomType, discountReason, appliedPromo, appliedMember]);

  useEffect(() => {
    const code = draft.promoCode.trim();
    if (!code || stayPrice <= 0) {
      setPromoDiscountAmt(0);
      setPromoStatus(null);
      return;
    }
    setPromoStatus('Checking promo…');
    const timer = window.setTimeout(() => {
      void validatePromoCode(code, stayPrice).then(result => {
        if (result.valid && typeof result.discountAmount === 'number' && result.discountAmount > 0) {
          setPromoDiscountAmt(result.discountAmount);
          setPromoStatus(`Promo accepted — you save ${peso(result.discountAmount)}`);
        } else {
          setPromoDiscountAmt(0);
          setPromoStatus(result.message ?? 'Invalid promo code');
        }
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft.promoCode, stayPrice]);

  useEffect(() => {
    const id = draft.membershipId.trim();
    if (!id || stayPrice <= 0) {
      setMemberDiscountAmt(0);
      setMemberStatus(null);
      return;
    }
    setMemberStatus('Checking membership…');
    const timer = window.setTimeout(() => {
      void validateMembershipId(id, stayPrice).then((result) => {
        if (result.valid && typeof result.discountAmount === 'number' && result.discountAmount > 0) {
          setMemberDiscountAmt(result.discountAmount);
          setMemberStatus(result.message ?? `Member discount — you save ${peso(result.discountAmount)}`);
        } else {
          setMemberDiscountAmt(0);
          setMemberStatus(result.message ?? 'Invalid membership ID');
        }
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft.membershipId, stayPrice]);

  const detailsProblem = missingDetails(draft, validIdFile);
  const detailsHref = `/booking/${propertyId}?${query}`;
  const changeSelectionHref = property?.hotelId ? `/hotels/${property.hotelId}?${query}#rooms` : '/search';

  const goToFinish = () => {
    if (detailsProblem) {
      showToast({ title: detailsProblem, type: 'error' });
      return;
    }
    navigate(`/booking/${propertyId}/finish?${query}`);
    window.scrollTo({ top: 0 });
  };

  const completeBooking = async () => {
    if (!property || detailsProblem || !validIdFile) {
      showToast({ title: detailsProblem ?? 'Please check your details', type: 'error' });
      return;
    }
    if (!agreed) {
      showToast({ title: 'Please agree to the Terms and Privacy Policy', type: 'error' });
      return;
    }
    setIsSubmitting(true);
    try {
      const booking = await createBookingRequestApi({
        propertyId,
        propertyName: formatRoomLabel(property),
        guestName: draft.fullName.trim(),
        guestEmail: draft.email.trim(),
        guestPhone: draft.phone.trim(),
        checkInDate: stay.checkIn,
        checkOutDate: stay.checkOut,
        adults: stay.adults,
        children: stay.children,
        infants: 0,
        roomType,
        paymentMethod,
        discountReason,
        promoCode: appliedPromo,
        membershipId: appliedMember,
        validIdFile,
        specialRequests: buildSpecialRequests(draft, validIdFile.name),
      });
      appendBooking(booking);
      clearDraft(propertyId);
      const receiptToken = (booking as { receiptToken?: string }).receiptToken;
      const params = new URLSearchParams({ email: draft.email.trim() });
      if (receiptToken) params.set('token', receiptToken);
      navigate(`/booking/confirm/${booking.id}?${params.toString()}`);
    } catch (err) {
      showToast({ title: 'Booking failed', description: errorMessageFromUnknown(err, 'Please try again.'), type: 'error' });
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

  const roomLabel = formatRoomLabel(property);
  const quoteBlocksBooking = !quote || Boolean(quoteError) || !quote.available;

  return (
    <div className="min-h-screen bg-brand-background pt-28 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <CheckoutProgress step={step === 'details' ? 1 : 2} />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
          <div className="min-w-0 lg:order-2">
            <CheckoutSummary
              roomName={roomLabel}
              roomImage={(property as { imageUrl?: string }).imageUrl || property.image}
              hotelName={property.hotelName}
              location={property.hotelLocation || property.location}
              stay={stay}
              changeSelectionHref={changeSelectionHref}
              quote={quote}
              quoteLoading={quoteLoading}
              quoteError={quoteError}
              freeCancellation={(property as { freeCancellation?: boolean }).freeCancellation}
            />
          </div>

          <div className="min-w-0 lg:order-1 space-y-5">
            {step === 'details' ? (
              <DetailsStep
                draft={draft}
                update={update}
                validIdFile={validIdFile}
                onValidId={changeValidId}
                promoStatus={promoStatus}
                promoAccepted={promoDiscountAmt > 0}
                memberStatus={memberStatus}
                memberAccepted={memberDiscountAmt > 0}
                onError={(title) => showToast({ title, type: 'error' })}
                onNext={goToFinish}
              />
            ) : detailsProblem ? (
              <Card>
                <h1 className="text-xl font-bold text-brand-dark mb-2">A few details are missing</h1>
                <p className="text-sm font-bold text-brand-dark/65 mb-4">
                  {detailsProblem}{!validIdFile ? ' (For your security, an uploaded ID is not kept after the page reloads.)' : ''}
                </p>
                <Link to={detailsHref} className="btn-primary inline-block">Back to your details</Link>
              </Card>
            ) : (
              <>
                <Card>
                  <ReviewHeader title="Your details" editHref={detailsHref} />
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <ReviewItem label="Name" value={draft.fullName} />
                    <ReviewItem label="Email" value={draft.email} />
                    <ReviewItem label="Phone" value={draft.phone} />
                    <ReviewItem label="Nationality" value={draft.nationality} />
                    {draft.bookingForSomeoneElse && <ReviewItem label="Guest staying" value={draft.stayGuestName} />}
                    <ReviewItem label="Valid ID" value={validIdFile?.name ?? ''} />
                    {draft.arrivalTime && <ReviewItem label="Estimated arrival" value={draft.arrivalTime} />}
                    {draft.specialRequests.trim() && <ReviewItem label="Special requests" value={draft.specialRequests.trim()} />}
                    {discountReason && <ReviewItem label="Discount" value={discountReason === 'pwd' ? 'PWD (ID checked at check-in)' : 'Senior citizen (ID checked at check-in)'} />}
                    {appliedPromo && <ReviewItem label="Promo code" value={appliedPromo} />}
                    {appliedMember && <ReviewItem label="Membership ID" value={appliedMember} />}
                  </dl>
                </Card>

                <Card>
                  <ReviewHeader title="Your stay" editHref={changeSelectionHref} editLabel="Change" />
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <ReviewItem label="Room" value={roomLabel} />
                    <ReviewItem label="Guests" value={`${describeGuests(stay)} · 1 room`} />
                    <ReviewItem label="Check-in" value={`${formatStayDate(stay.checkIn)}, from 2:00 PM`} />
                    <ReviewItem label="Check-out" value={`${formatStayDate(stay.checkOut)}, until 12:00 PM`} />
                    {quote && <ReviewItem label="Total" value={`${peso(quote.totalPrice)} (taxes and charges included)`} />}
                  </dl>
                </Card>

                <Card>
                  <h2 className="text-lg font-bold text-brand-dark mb-2 flex items-center gap-2"><Wallet className="w-5 h-5 text-brand-primary" aria-hidden />How you'll pay</h2>
                  <div className="rounded-xl border-2 border-brand-primary bg-brand-primary/5 p-4">
                    <p className="font-bold text-brand-dark">Pay after the hotel confirms — GCash or Maya QR</p>
                    <p className="mt-1 text-sm text-brand-dark/65">
                      You won't be charged today. When the hotel confirms, we email you a secure link to pay
                      {quote ? ` the full ${peso(quote.dueAfterConfirmation)}` : ' the full stay'} by scanning the hotel's QR and uploading your receipt.
                    </p>
                  </div>
                </Card>

                <Card>
                  <label className="flex items-start gap-3 text-sm font-bold text-brand-dark">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-primary" />
                    <span>
                      I agree to the <Link to="/terms" target="_blank" className="text-brand-primary underline">Terms of Service</Link> and{' '}
                      <Link to="/privacy" target="_blank" className="text-brand-primary underline">Privacy Policy</Link>, and I understand this is a reservation
                      request that the hotel must confirm.
                    </span>
                  </label>
                  <button
                    id="booking-submit"
                    type="button"
                    disabled={isSubmitting || !agreed || quoteBlocksBooking}
                    onClick={() => void completeBooking()}
                    className="mt-4 btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2 py-4 text-base"
                  >
                    {isSubmitting
                      ? <><Loader2 className="w-5 h-5 animate-spin" /> Sending your request…</>
                      : <><ShieldCheck className="w-5 h-5" /> Complete booking</>}
                  </button>
                  <p className="mt-2 text-center text-xs font-bold text-brand-dark/50">No payment is taken now.</p>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-4 sm:p-6">{children}</section>;
}

function ReviewHeader({ title, editHref, editLabel = 'Edit' }: { title: string; editHref: string; editLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-lg font-bold text-brand-dark">{title}</h2>
      <Link to={editHref} className="flex items-center gap-1 text-sm font-bold text-brand-primary underline underline-offset-2">
        <Pencil className="w-3.5 h-3.5" aria-hidden />{editLabel}
      </Link>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold text-brand-dark/50">{label}</dt>
      <dd className="font-bold text-brand-dark break-words">{value || '—'}</dd>
    </div>
  );
}

function DetailsStep({
  draft,
  update,
  validIdFile,
  onValidId,
  promoStatus,
  promoAccepted,
  memberStatus,
  memberAccepted,
  onError,
  onNext,
}: {
  draft: CheckoutDraft;
  update: (patch: Partial<CheckoutDraft>) => void;
  validIdFile: File | null;
  onValidId: (file: File | null) => void;
  promoStatus: string | null;
  promoAccepted: boolean;
  memberStatus: string | null;
  memberAccepted: boolean;
  onError: (title: string) => void;
  onNext: () => void;
}) {
  const sectionTitle = 'text-base font-bold uppercase tracking-widest text-brand-primary mb-4 flex items-center gap-2';
  return (
    <form
      noValidate
      onSubmit={(e) => { e.preventDefault(); onNext(); }}
      className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-4 sm:p-6 space-y-7"
    >
      <section>
        <h1 className={sectionTitle}><User className="w-4 h-4" /> Enter your details</h1>
        <div className="space-y-4">
          <div>
            <label htmlFor="booking-fullname" className="field-label">Full Name <span className="text-red-400">*</span></label>
            <input id="booking-fullname" type="text" autoComplete="name" value={draft.fullName}
              onChange={e => update({ fullName: e.target.value })} placeholder="Full name as shown on ID" className="input-field" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="booking-email" className="field-label">Email Address <span className="text-red-400">*</span></label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                <input id="booking-email" type="email" autoComplete="email" value={draft.email}
                  onChange={e => update({ email: e.target.value })} placeholder="yourname@gmail.com" className="input-field !pl-10" />
              </div>
              <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">The hotel's confirmation and payment link are sent here. Please double-check it.</p>
            </div>
            <div>
              <label htmlFor="booking-phone" className="field-label">Phone Number <span className="text-red-400">*</span></label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                <input id="booking-phone" type="tel" autoComplete="tel" value={draft.phone}
                  onChange={e => update({ phone: e.target.value })} placeholder="+63 9XX XXX XXXX" className="input-field !pl-10" />
              </div>
            </div>
          </div>
          <div>
            <label htmlFor="booking-nationality" className="field-label"><Globe className="inline w-3.5 h-3.5 mr-1 text-brand-primary" />Nationality</label>
            <div className="relative">
              <select id="booking-nationality" value={draft.nationality} onChange={e => update({ nationality: e.target.value })} className="input-field appearance-none !pr-10">
                {NATIONALITIES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
            </div>
          </div>

          <fieldset>
            <legend className="field-label">Who are you booking for?</legend>
            <div className="flex flex-wrap gap-4 text-sm font-bold text-brand-dark">
              <label className="flex items-center gap-2">
                <input type="radio" name="booking-for" checked={!draft.bookingForSomeoneElse} onChange={() => update({ bookingForSomeoneElse: false })} className="accent-brand-primary" />
                I'm the main guest
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="booking-for" checked={draft.bookingForSomeoneElse} onChange={() => update({ bookingForSomeoneElse: true })} className="accent-brand-primary" />
                I'm booking for someone else
              </label>
            </div>
            {draft.bookingForSomeoneElse && (
              <div className="mt-3">
                <label htmlFor="booking-stay-guest" className="field-label">Full name of the guest staying <span className="text-red-400">*</span></label>
                <input id="booking-stay-guest" type="text" value={draft.stayGuestName}
                  onChange={e => update({ stayGuestName: e.target.value })} className="input-field" />
              </div>
            )}
          </fieldset>

          <div>
            <label htmlFor="booking-valid-id" className="field-label flex items-center justify-between">
              <span><ShieldCheck className="inline w-3.5 h-3.5 mr-1 text-brand-primary" />Valid ID <span className="text-red-400">*</span></span>
              <span className="text-[10px] text-brand-dark/40 font-normal">Passport, driver's license, or government ID</span>
            </label>
            <label
              htmlFor="booking-valid-id"
              className={`mt-1 flex flex-col items-center justify-center w-full p-4 transition-colors border-2 border-dashed rounded-xl cursor-pointer ${
                validIdFile
                  ? 'border-brand-success bg-brand-success/5 text-brand-success'
                  : 'border-brand-primary/25 bg-brand-background/40 hover:bg-brand-background/70 hover:border-brand-primary/50 text-brand-dark/60'
              }`}
            >
              {validIdFile ? (
                <span className="flex items-center justify-between w-full gap-2 text-sm font-bold">
                  <span className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span className="truncate">{validIdFile.name}</span>
                    <span className="text-xs font-normal text-brand-dark/50 shrink-0">({(validIdFile.size / 1024).toFixed(0)} KB)</span>
                  </span>
                  <span className="text-xs text-brand-primary underline shrink-0">Change ID</span>
                </span>
              ) : (
                <span className="flex flex-col items-center text-center py-2">
                  <Upload className="w-6 h-6 mb-2 text-brand-primary/60" />
                  <span className="text-xs font-bold text-brand-dark">Click to upload your valid ID</span>
                  <span className="text-[10px] text-brand-dark/50 mt-0.5">JPG, PNG, WEBP, or PDF (max 5 MB) — shared only with the hotel</span>
                </span>
              )}
              <input
                id="booking-valid-id"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!VALID_ID_TYPES.includes(file.type)) {
                    onError('Valid ID must be a JPG, PNG, WEBP, or PDF');
                    e.target.value = '';
                    return;
                  }
                  if (file.size > 5 * 1024 * 1024) {
                    onError('Valid ID must be 5 MB or smaller');
                    e.target.value = '';
                    return;
                  }
                  onValidId(file);
                }}
              />
            </label>
          </div>
        </div>
      </section>

      <div className="h-px bg-brand-primary/10" />

      <section>
        <h2 className={sectionTitle}><Clock className="w-4 h-4" /> Your arrival time</h2>
        <label htmlFor="booking-arrival" className="field-label">Estimated arrival (optional)</label>
        <div className="relative">
          <select id="booking-arrival" value={draft.arrivalTime} onChange={e => update({ arrivalTime: e.target.value })} className="input-field appearance-none !pr-10">
            <option value="">I don't know yet</option>
            {ARRIVAL_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
        </div>
        <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">Check-in is from 2:00 PM.</p>
      </section>

      <section>
        <h2 className={sectionTitle}><MessageSquare className="w-4 h-4" /> Special requests</h2>
        <label htmlFor="booking-requests" className="field-label">Anything the hotel should know? (optional)</label>
        <textarea id="booking-requests" rows={3} maxLength={300} value={draft.specialRequests}
          onChange={e => update({ specialRequests: e.target.value })} className="input-field" />
        <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">Requests depend on availability and aren't guaranteed.</p>
        <div className="mt-4">
          <span className="field-label">Head count by sex (optional, for the hotel's records)</span>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-[10px] text-brand-dark/50 font-bold">Male
              <input type="number" min={0} value={draft.malePax} onChange={e => update({ malePax: Math.max(0, Number(e.target.value)) })} className="input-field mt-1" />
            </label>
            <label className="text-[10px] text-brand-dark/50 font-bold">Female
              <input type="number" min={0} value={draft.femalePax} onChange={e => update({ femalePax: Math.max(0, Number(e.target.value)) })} className="input-field mt-1" />
            </label>
          </div>
        </div>
      </section>

      <div className="h-px bg-brand-primary/10" />

      <section>
        <h2 className={sectionTitle}><Tag className="w-4 h-4" /> Discounts</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="booking-discount" className="field-label">PWD / Senior citizen</label>
            <div className="relative">
              <select id="booking-discount" value={draft.discountType} onChange={e => update({ discountType: e.target.value })} className="input-field appearance-none pr-9">
                {BOOKING_DISCOUNT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
            </div>
            {draft.discountType && <p className="mt-1.5 text-[11px] text-brand-dark/55 font-bold">Bring the matching ID — the hotel checks it at check-in.</p>}
          </div>
          <div>
            <label htmlFor="booking-membership" className="field-label">Madyaw Membership ID</label>
            <input id="booking-membership" type="text" autoComplete="off" value={draft.membershipId}
              onChange={e => update({ membershipId: e.target.value.toUpperCase() })} placeholder="e.g. SHID-XXXXXXXX" className="input-field uppercase" />
            <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">
              Points wallet discount, once per day. <Link to="/become-a-member" className="text-brand-primary underline">Be a member</Link>
            </p>
            {memberStatus && <p className={`mt-1 text-xs font-bold ${memberAccepted ? 'text-brand-success' : 'text-brand-dark/55'}`}>{memberAccepted ? '✓ ' : ''}{memberStatus}</p>}
          </div>
          <div>
            <label htmlFor="booking-promo" className="field-label">Promo code</label>
            <input id="booking-promo" type="text" value={draft.promoCode}
              onChange={e => update({ promoCode: e.target.value.toUpperCase() })} placeholder="Optional" className="input-field uppercase" />
            {promoStatus && <p className={`mt-1 text-xs font-bold ${promoAccepted ? 'text-brand-success' : 'text-brand-dark/55'}`}>{promoAccepted ? '✓ ' : ''}{promoStatus}</p>}
          </div>
          <p className="text-[11px] text-brand-dark/45 font-bold">If more than one discount applies, the largest one is used. Your total updates on the right.</p>
        </div>
      </section>

      <button type="submit" className="btn-primary w-full py-4 text-base">Next: Final details</button>
    </form>
  );
}
