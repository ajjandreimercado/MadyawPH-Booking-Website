import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, CheckCircle2, ShieldCheck, ChevronDown, Globe,
  Phone, Mail, User, Tag, Upload, Clock, MessageSquare, Wallet, Pencil,
} from 'lucide-react';
import { fetchPropertyById, createBookingRequestApi } from '../api/propertyService';
import { fetchRoomCategory, quoteStay, validatePromoCode, validateMembershipId, type StayQuote } from '../services/api';
import { useToast } from '../components/ui/ToastProvider';
import type { BookingPaymentMethod, BookingRoomType, RoomCategory } from '../types';
import { BookingFormSkeleton } from '../components/ui/Skeleton';
import { cacheKey, peekCache } from '../lib/queryCache';
import { errorMessageFromUnknown } from '../lib/apiError';
import { describeGuests, formatStayDate, peso, readStay, stayQuery } from '../lib/stayParams';
import {
  ARRIVAL_SLOTS, arrivalLabel, buildSpecialRequests, clearDraft, getPaymentProof, loadDraft, saveDraft,
  setPaymentProof, type CheckoutDraft,
} from '../lib/checkoutDraft';
import PayByQr from '../components/booking/PayByQr';
import CheckoutSummary, { CheckoutProgress, clockLabel } from '../components/booking/CheckoutSummary';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function missingDetails(draft: CheckoutDraft): string | null {
  if (!draft.fullName.trim()) return 'Enter your full name.';
  // Quick booking: name plus an email OR a mobile number is enough — no account needed.
  const email = draft.email.trim();
  const phone = draft.phone.trim();
  if (!email && !phone) return 'Enter your email address or your mobile phone number so the hotel can confirm your booking.';
  if (email && !EMAIL_RE.test(email)) return 'Enter a valid email address, or leave it blank and use your mobile number.';
  if (!email && phone.replace(/\D/g, '').length < 7) return 'Enter a valid mobile phone number.';
  if (draft.bookingForSomeoneElse && !draft.stayGuestName.trim()) return 'Enter the name of the guest who will stay.';
  return null;
}

/**
 * Checkout in two steps, like Booking.com:
 *   /booking/:categoryId         → (1) Your details
 *   /booking/:categoryId/finish  → (2) Finish booking (review, terms, Complete booking)
 * Guests book a room type; the server assigns a free room of that type (never shown to them).
 * Dates and guests come from the URL; typed details persist in sessionStorage.
 */
export default function BookingPage({ step = 'details' }: { step?: 'details' | 'finish' }) {
  const { categoryId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const stay = readStay(searchParams);
  const query = stayQuery(stay);
  // Multi-category booking (?cats=id1,id2 from the hotel page): one checkout and one
  // payment covering one room of each listed type, primary category first.
  const categoryIds = [...new Set(
    [categoryId, ...(searchParams.get('cats')?.split(',') ?? [])]
      .map((id) => id.trim())
      .filter(Boolean),
  )].slice(0, 5);
  const isMultiCategory = categoryIds.length >= 2;

  const [category, setCategory] = useState<RoomCategory | null>(() =>
    categoryId ? peekCache<RoomCategory>(cacheKey(['room-category', categoryId])) ?? null : null,
  );
  const [isLoading, setIsLoading] = useState(() =>
    !(categoryId && peekCache(cacheKey(['room-category', categoryId]))),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  /** Set right after a successful submission — shows the "Processing Payment…" popup. */
  const [submitted, setSubmitted] = useState<{ references: string[] } | null>(null);
  const [, startTransition] = useTransition();

  const [draft, setDraft] = useState<CheckoutDraft>(() => loadDraft(categoryId));
  const update = (patch: Partial<CheckoutDraft>) => setDraft((prev) => {
    const next = { ...prev, ...patch };
    saveDraft(categoryId, next);
    return next;
  });
  const [paymentProofFile, setPaymentProofState] = useState<File | null>(() => getPaymentProof(categoryId));
  const changePaymentProof = (file: File | null) => {
    setPaymentProof(categoryId, file);
    setPaymentProofState(file);
  };
  const paymentReady = Boolean(paymentProofFile);

  const [promoDiscountAmt, setPromoDiscountAmt] = useState(0);
  const [promoStatus, setPromoStatus] = useState<string | null>(null);
  const [memberDiscountAmt, setMemberDiscountAmt] = useState(0);
  const [memberStatus, setMemberStatus] = useState<string | null>(null);

  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<BookingPaymentMethod>('gcash');
  // The server prices and names room-type bookings from the room it assigns.
  const roomType = 'standard-room' as BookingRoomType;
  // Only codes the server already accepted go into the price quote, so a typo can't block pricing.
  const appliedPromo = promoDiscountAmt > 0 ? draft.promoCode.trim() : undefined;
  const appliedMember = memberDiscountAmt > 0 ? draft.membershipId.trim() : undefined;
  const stayPrice = quote?.stayPrice ?? 0;
  // Booking type (Individual vs Group 50% down payment) only exists for 2+ room types.
  const effectiveGroupBooking = isMultiCategory && draft.groupBooking;
  const [extraCategories, setExtraCategories] = useState<RoomCategory[]>([]);

  // Names/photos of the other booked room types (primary category loads separately).
  useEffect(() => {
    const others = categoryIds.filter((id) => id !== categoryId);
    if (others.length === 0) {
      setExtraCategories([]);
      return;
    }
    let cancelled = false;
    void Promise.all(others.map((id) => fetchRoomCategory(id).catch(() => null)))
      .then((list) => {
        if (!cancelled) setExtraCategories(list.filter((c): c is RoomCategory => Boolean(c)));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- categoryIds derives from the URL
  }, [categoryIds.join(','), categoryId]);

  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    const cached = peekCache<RoomCategory>(cacheKey(['room-category', categoryId]));
    if (cached) {
      setCategory(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    fetchRoomCategory(categoryId)
      .then((c) => {
        if (cancelled) return;
        startTransition(() => setCategory(c));
        setIsLoading(false);
      })
      .catch(async () => {
        // Older links point at one room (/booking/<roomId>): move them to that room's type.
        try {
          const room = await fetchPropertyById(categoryId);
          if (!cancelled && room.categoryId) {
            navigate(location.pathname.replace(categoryId, room.categoryId) + location.search, { replace: true });
            return;
          }
        } catch {
          // fall through to "not found"
        }
        if (cancelled) return;
        setIsLoading(false);
        if (!cached) showToast({ title: 'Unable to load this room type', type: 'error' });
      });
    return () => { cancelled = true; };
  }, [categoryId]);

  // Server price for this stay — the same numbers the booking will be saved with.
  useEffect(() => {
    if (!category) return;
    let cancelled = false;
    setQuoteLoading(true);
    const timer = window.setTimeout(() => {
      quoteStay({
        categoryId,
        categoryIds: isMultiCategory ? categoryIds : undefined,
        // Hourly rooms are priced from the arrival time (window start).
        arrivalTime: /^\d{2}:\d{2}$/.test(draft.arrivalTime) ? draft.arrivalTime : undefined,
        checkInDate: stay.checkIn,
        checkOutDate: stay.checkOut,
        adults: stay.adults,
        children: stay.children,
        promoCode: appliedPromo,
        membershipId: appliedMember,
        groupBooking: effectiveGroupBooking,
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
  }, [category, categoryId, stay.checkIn, stay.checkOut, stay.adults, stay.children, appliedPromo, appliedMember, draft.arrivalTime, effectiveGroupBooking, isMultiCategory, categoryIds.join(',')]);

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

  const detailsProblem = missingDetails(draft);
  const detailsHref = `/booking/${categoryId}?${query}`;
  const changeSelectionHref = category?.hotelId ? `/hotels/${category.hotelId}?${query}#rooms` : '/search';

  const goToFinish = () => {
    if (detailsProblem) {
      showToast({ title: detailsProblem, type: 'error' });
      return;
    }
    navigate(`/booking/${categoryId}/finish?${query}`);
    window.scrollTo({ top: 0 });
  };

  const completeBooking = async () => {
    if (!category || detailsProblem) {
      showToast({ title: detailsProblem ?? 'Please check your details', type: 'error' });
      return;
    }
    const amountDue = Number(quote?.dueNow ?? quote?.totalPrice ?? 0);
    if (!quote || quoteLoading || quoteError || !quote.available || !(amountDue > 0)) {
      showToast({
        title: 'Price not ready',
        description: quoteError
          ?? 'We could not get the stay total yet. Wait a moment or go back and pick the room again.',
        type: 'error',
      });
      return;
    }
    if (!paymentProofFile) {
      showToast({
        title: 'Add your payment screenshot',
        description: 'Upload the screenshot of the payment you just made.',
        type: 'error',
      });
      return;
    }
    if (!agreed) {
      showToast({ title: 'Please agree to the Terms and Privacy Policy', type: 'error' });
      return;
    }
    setIsSubmitting(true);
    try {
      const booking = await createBookingRequestApi({
        categoryId,
        propertyName: category.name,
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
        promoCode: appliedPromo,
        membershipId: appliedMember,
        groupBooking: effectiveGroupBooking,
        categoryIds: isMultiCategory ? categoryIds : undefined,
        policyAcknowledged: agreed,
        paymentProofFile,
        arrivalTime: /^\d{2}:\d{2}$/.test(draft.arrivalTime) ? draft.arrivalTime : undefined,
        specialRequests: buildSpecialRequests({ ...draft, groupBooking: effectiveGroupBooking }),
      });
      clearDraft(categoryId);
      const references = (booking as { bookingReferences?: string[] }).bookingReferences ?? [];
      setSubmitted({ references: references.length > 0 ? references : [booking.bookingReference ?? ''].filter(Boolean) });
      window.scrollTo({ top: 0 });
    } catch (err) {
      showToast({ title: 'Booking failed', description: errorMessageFromUnknown(err, 'Please try again.'), type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading && !category) {
    return <BookingFormSkeleton />;
  }

  if (!category) {
    return (
      <div className="min-h-screen bg-brand-background flex items-center justify-center p-4 pt-32 pb-16">
        <div className="bg-brand-cream rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-serif font-bold text-brand-dark mb-3">Room type not found</h2>
          <button onClick={() => navigate(-1)} className="btn-primary">Go Back</button>
        </div>
      </div>
    );
  }

  const bookedCategories = isMultiCategory
    ? categoryIds.flatMap((id) => {
      const found = id === categoryId ? category : extraCategories.find((c) => c.id === id);
      return found ? [found] : [];
    })
    : [category];
  const roomLabel = isMultiCategory && bookedCategories.length > 1
    ? bookedCategories.map((c) => c.name).join(', ')
    : category.name;
  const roomsLabel = isMultiCategory ? `${categoryIds.length} rooms (one per room type)` : '1 room';
  const quoteBlocksBooking = !quote || Boolean(quoteError) || !quote.available || !(Number(quote.totalPrice) > 0);

  return (
    <div className="min-h-screen bg-brand-background pt-28 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <CheckoutProgress step={step === 'details' ? 1 : 2} />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
          <div className="min-w-0 lg:order-2">
            <CheckoutSummary
              roomName={roomLabel}
              roomImage={category.imageUrl}
              hotelName={quote?.hotelName}
              location={quote?.hotelLocation}
              stay={stay}
              changeSelectionHref={changeSelectionHref}
              quote={quote}
              quoteLoading={quoteLoading}
              quoteError={quoteError}
              freeCancellation={quote?.freeCancellation}
              showCancellation={step === 'finish'}
              large={step === 'finish' && !detailsProblem}
              roomsLabel={roomsLabel}
            />
          </div>

          <div className="min-w-0 lg:order-1 space-y-5">
            {submitted ? (
              <Card>
                <div className="text-center py-4">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-brand-success" aria-hidden />
                  <h1 className="mt-3 text-xl font-bold text-brand-dark">Booking Successful!</h1>
                  <p className="mt-2 text-sm font-bold italic text-brand-dark/70">
                    We will notify you once your payment has been confirmed by our front desk.
                  </p>
                  {submitted.references.length > 0 && (
                    <p className="mt-4 text-base font-bold text-brand-dark">Booking #- {submitted.references.join(', ')}</p>
                  )}
                </div>
              </Card>
            ) : step === 'details' ? (
              <DetailsStep
                draft={draft}
                update={update}
                onError={(title) => showToast({ title, type: 'error' })}
                onNext={goToFinish}
              />
            ) : detailsProblem ? (
              <Card>
                <h1 className="text-xl font-bold text-brand-dark mb-2">A few details are missing</h1>
                <p className="text-sm font-bold text-brand-dark/65 mb-4">
                  {detailsProblem}
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
                    {draft.arrivalTime && <ReviewItem label="Estimated arrival" value={arrivalLabel(draft.arrivalTime) || draft.arrivalTime} />}
                  </dl>
                </Card>

                <Card>
                  <ReviewHeader title="Your stay" editHref={changeSelectionHref} editLabel="Change" />
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <ReviewItem label={isMultiCategory ? 'Rooms' : 'Room'} value={roomLabel} />
                    {isMultiCategory && (
                      <ReviewItem label="Booking type" value={effectiveGroupBooking ? 'Group booking · 50% down payment' : 'Individual booking · full payment'} />
                    )}
                    <ReviewItem label="Guests" value={`${describeGuests(stay)} · ${roomsLabel}`} />
                    <ReviewItem label="Check-in" value={`${formatStayDate(stay.checkIn)}, from ${clockLabel(quote?.checkInTime ?? '14:00')}`} />
                    <ReviewItem label="Check-out" value={`${formatStayDate(quote?.checkOutDate ?? stay.checkOut)}, until ${clockLabel(quote?.checkOutTime ?? '11:00')}`} />
                    {quote && <ReviewItem label="Total" value={`${peso(quote.totalPrice)} (taxes and charges included)`} />}
                  </dl>
                </Card>

                {isMultiCategory && (
                <Card>
                  <h2 className="text-lg font-bold text-brand-dark mb-3">Booking type</h2>
                  <p className="mb-3 text-xs font-bold text-brand-dark/55">
                    You're booking {categoryIds.length} room types together, so you can choose how to pay.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Booking type">
                    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${!draft.groupBooking ? 'border-brand-primary bg-brand-primary/5' : 'border-brand-primary/20'}`}>
                      <input
                        type="radio"
                        name="booking-type"
                        checked={!draft.groupBooking}
                        onChange={() => update({ groupBooking: false })}
                        className="mt-0.5 accent-brand-primary"
                      />
                      <span>
                        <span className="block text-sm font-bold text-brand-dark">Individual booking</span>
                        <span className="block text-xs font-bold text-brand-dark/55">Pay the full stay now by QR.</span>
                      </span>
                    </label>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${draft.groupBooking ? 'border-brand-primary bg-brand-primary/5' : 'border-brand-primary/20'}`}>
                      <input
                        type="radio"
                        name="booking-type"
                        checked={draft.groupBooking}
                        onChange={() => update({ groupBooking: true })}
                        className="mt-0.5 accent-brand-primary"
                      />
                      <span>
                        <span className="block text-sm font-bold text-brand-dark">Group booking</span>
                        <span className="block text-xs font-bold text-brand-dark/55">
                          Pay only a 50% down payment now{quote ? ` (${peso(quote.dueNow)})` : ''}; the balance is paid at the hotel.
                        </span>
                      </span>
                    </label>
                  </div>
                </Card>
                )}

                <Card>
                  <h2 className="text-lg font-bold text-brand-dark mb-4 flex items-center gap-2"><Wallet className="w-5 h-5 text-brand-primary" aria-hidden />Pay for your stay</h2>
                  {effectiveGroupBooking && quote && quote.dueAfterConfirmation > 0 && (
                    <p className="mb-3 rounded-xl bg-brand-primary/5 border border-brand-primary/15 px-3 py-2 text-xs font-bold text-brand-dark/70">
                      Group booking: pay <span className="text-brand-dark">{peso(quote.dueNow)}</span> (50% down payment) now.
                      The remaining <span className="text-brand-dark">{peso(quote.dueAfterConfirmation)}</span> is paid at the hotel.
                    </p>
                  )}
                  <PayByQr
                    hotelId={category.hotelId}
                    amount={quote?.dueNow ?? quote?.totalPrice ?? null}
                    file={paymentProofFile}
                    onFile={changePaymentProof}
                    onError={(title) => showToast({ title, type: 'error' })}
                    onMethodChange={setPaymentMethod}
                  />
                </Card>

                <Card>
                  <h2 className="text-lg font-bold text-brand-dark mb-4 flex items-center gap-2"><Tag className="w-5 h-5 text-brand-primary" aria-hidden />Discounts</h2>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="booking-membership" className="field-label">Madyaw Membership ID</label>
                      <input id="booking-membership" type="text" autoComplete="off" value={draft.membershipId}
                        onChange={e => update({ membershipId: e.target.value.toUpperCase() })} placeholder="e.g. SHID-XXXXXXXX" className="input-field uppercase" />
                      <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">
                        Points wallet discount, once per day. <Link to="/become-a-member" className="text-brand-primary underline">Be a member</Link>
                      </p>
                      {memberStatus && <p className={`mt-1 text-xs font-bold ${memberDiscountAmt > 0 ? 'text-brand-success' : 'text-brand-dark/55'}`}>{memberDiscountAmt > 0 ? '✓ ' : ''}{memberStatus}</p>}
                    </div>
                    <div>
                      <label htmlFor="booking-promo" className="field-label">Promo code</label>
                      <input id="booking-promo" type="text" value={draft.promoCode}
                        onChange={e => update({ promoCode: e.target.value.toUpperCase() })} placeholder="Optional" className="input-field uppercase" />
                      {promoStatus && <p className={`mt-1 text-xs font-bold ${promoDiscountAmt > 0 ? 'text-brand-success' : 'text-brand-dark/55'}`}>{promoDiscountAmt > 0 ? '✓ ' : ''}{promoStatus}</p>}
                    </div>
                    <p className="text-[11px] text-brand-dark/45 font-bold">
                      If more than one discount applies, the largest one is used. The amount to pay in your booking summary updates when a discount is accepted.
                    </p>
                  </div>
                </Card>

                <Card>
                  <h2 className="text-lg font-bold text-brand-dark mb-4 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-brand-primary" aria-hidden />Special requests</h2>
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
                </Card>

                <Card>
                  <label className="flex items-start gap-3 text-sm font-bold text-brand-dark">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-primary" />
                    <span>
                      I agree to the <Link to="/terms" target="_blank" className="text-brand-primary underline">Terms of Service</Link> and{' '}
                      <Link to="/privacy" target="_blank" className="text-brand-primary underline">Privacy Policy</Link>. I understand this booking is{' '}
                      <span className="text-brand-danger">non-refundable</span> and that the hotel confirms my stay after checking my payment.
                    </span>
                  </label>
                  <button
                    id="booking-submit"
                    type="button"
                    disabled={isSubmitting || !agreed || !paymentReady || quoteBlocksBooking}
                    onClick={() => void completeBooking()}
                    className="mt-4 btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2 py-4 text-base"
                  >
                    {isSubmitting
                      ? <><Loader2 className="w-5 h-5 animate-spin" /> Sending your request…</>
                      : <><ShieldCheck className="w-5 h-5" /> BOOK NOW!</>}
                  </button>
                  {!paymentReady && (
                    <p className="mt-2 text-center text-xs font-bold text-brand-dark/50">Upload your payment screenshot above to continue.</p>
                  )}
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
  onError,
  onNext,
}: {
  draft: CheckoutDraft;
  update: (patch: Partial<CheckoutDraft>) => void;
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
          <p className="text-[11px] text-brand-dark/45 font-bold -mt-1">
            No account needed — we just need your email <span className="text-brand-dark">or</span> mobile number so the hotel can confirm your booking.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="booking-email" className="field-label">Email Address <span className="text-brand-dark/40 font-normal">(or use mobile)</span></label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                <input
                  id="booking-email"
                  type="email"
                  autoComplete="email"
                  value={draft.email}
                  onChange={e => update({ email: e.target.value })}
                  placeholder="you@example.com (optional)"
                  className="input-field !pl-10"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">
                Optional — any email works, or leave this blank and use your mobile number.
                After the Front Office verifies your payment, your "Booking Successful!" email with a reservation QR code is sent here.
              </p>
            </div>
            <div>
              <label htmlFor="booking-phone" className="field-label">Mobile Phone Number <span className="text-brand-dark/40 font-normal">(or use email)</span></label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
                <input id="booking-phone" type="tel" autoComplete="tel" value={draft.phone}
                  onChange={e => update({ phone: e.target.value })} placeholder="+63 9XX XXX XXXX" className="input-field !pl-10" />
              </div>
              <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">
                No email? The Front Office will call this number to confirm your booking.
              </p>
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
        </div>
      </section>

      <div className="h-px bg-brand-primary/10" />

      <section>
        <h2 className={sectionTitle}><Clock className="w-4 h-4" /> Your arrival time</h2>
        <label htmlFor="booking-arrival" className="field-label">Estimated arrival (optional)</label>
        <div className="relative">
          <select id="booking-arrival" value={draft.arrivalTime} onChange={e => update({ arrivalTime: e.target.value })} className="input-field appearance-none !pr-10">
            <option value="">I don't know yet</option>
            {ARRIVAL_SLOTS.map(slot => <option key={slot.value} value={slot.value}>{slot.label}</option>)}
          </select>
          <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/40 pointer-events-none" />
        </div>
        <p className="mt-1.5 text-[11px] text-brand-dark/45 font-bold">Check-in is from 2:00 PM (hourly rooms start at this time). The hotel sees this time with your booking.</p>
      </section>

      <button type="submit" className="btn-primary w-full py-4 text-base">Next: Final details</button>
    </form>
  );
}
