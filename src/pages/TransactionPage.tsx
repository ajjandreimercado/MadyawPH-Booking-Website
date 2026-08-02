import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { addDays, format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clock3,
  CreditCard,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  fetchPropertyById,
  createBookingRequest as createBookingRequestApi,
  updateBookingRequest as updateBookingRequestApi,
  reviewBookingAvailability,
  fetchRoomCategories,
  isAxiosError,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useBookings } from '../contexts/BookingsContext';
import { useToast } from '../components/ui/ToastProvider';
import type { BookingPaymentMethod, BookingRequest, BookingRoomType, BookingStatus, Property, RoomCategory } from '../types';
import {
  BOOKING_PAYMENT_PROCESSING_MS,
  BOOKING_REQUEST_EXPIRY_SECONDS,
  calculateBookingPricing,
  createBookingRequest,
  formatCountdown,
  PAYMENT_METHOD_OPTIONS,
  ROOM_TYPE_OPTIONS,
} from '../lib/bookingFlow';
import { trackBookingRequested } from '../lib/analytics';
import { sendAdminPartnerAlert, sendEmailConfirmation } from '../lib/notificationService';

type BookingViewState = BookingStatus | 'idle';

/**
 * Maps a free-form room category name from the API to the nearest
 * BookingRoomType enum value so that pricing helpers and the booking
 * submission payload remain consistent with the existing backend contract.
 */
function normalizeToRoomType(name: string): BookingRoomType {
  const lower = name.toLowerCase();
  if (lower.includes('villa') || lower.includes('retreat')) return 'villa-retreat';
  if (lower.includes('family')) return 'family-suite';
  if (lower.includes('deluxe')) return 'deluxe-suite';
  return 'standard-room';
}

const BOOKING_STEPS: Array<{ status: BookingStatus; label: string }> = [
  { status: 'requested', label: 'Requested' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'paid', label: 'Payment' },
  { status: 'confirmed', label: 'Confirmed' },
];

const ROOM_ORDER: BookingRoomType[] = ['standard-room', 'deluxe-suite', 'family-suite', 'villa-retreat'];
const PAYMENT_ORDER: BookingPaymentMethod[] = ['credit-card', 'gcash', 'bank-transfer'];

const STATUS_TONES: Record<BookingViewState, { label: string; className: string }> = {
  idle: {
    label: 'Ready to plan',
    className: 'bg-brand-primary/10 text-brand-dark border-brand-primary/10',
  },
  pending: {
    label: 'Pending',
    className: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  requested: {
    label: 'Pending review',
    className: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  accepted: {
    label: 'Availability confirmed',
    className: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  },
  declined: {
    label: 'Request declined',
    className: 'bg-red-100 text-red-900 border-red-200',
  },
  paid: {
    label: 'Payment processing',
    className: 'bg-brand-primary/10 text-brand-primary border-brand-primary/20',
  },
  confirmed: {
    label: 'Confirmed',
    className: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  },
  reserved: {
    label: 'Reserved',
    className: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  booked: {
    label: 'Booked',
    className: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-red-100 text-red-900 border-red-200',
  },
  completed: {
    label: 'Completed',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  },
};

function renderStatusIcon(status: BookingViewState) {
  switch (status) {
    case 'requested':
      return <Clock3 className="w-4 h-4" />;
    case 'accepted':
      return <ShieldCheck className="w-4 h-4" />;
    case 'declined':
      return <AlertTriangle className="w-4 h-4" />;
    case 'paid':
      return <Loader2 className="w-4 h-4 animate-spin" />;
    case 'confirmed':
      return <CheckCircle className="w-4 h-4" />;
    default:
      return <Sparkles className="w-4 h-4" />;
  }
}

function createLocalDate(daysFromToday: number) {
  return format(addDays(new Date(), daysFromToday), 'yyyy-MM-dd');
}

function formatDisplayDate(value: string) {
  if (!value) {
    return 'Select date';
  }
  return format(parseISO(value), 'MMM d, yyyy');
}

function SummaryRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/40 pt-0.5">{label}</p>
      <p className={`text-right ${emphasis ? 'text-brand-primary text-lg font-serif' : 'text-brand-dark'}`}>{value}</p>
    </div>
  );
}

export default function TransactionPage() {
  const { propertyId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { appendBooking } = useBookings();
  const { showToast } = useToast();
  const [property, setProperty] = useState<Property | null>(null);
  const [isPropertyLoading, setIsPropertyLoading] = useState(true);
  const [propertyError, setPropertyError] = useState('');
  const [bookingRequest, setBookingRequest] = useState<BookingRequest | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(BOOKING_REQUEST_EXPIRY_SECONDS);
  const [statusMessage, setStatusMessage] = useState('Plan your stay, then request availability for the selected dates.');
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [isBookingSubmitting, setIsBookingSubmitting] = useState(false);
  const [checkInDate, setCheckInDate] = useState(() => createLocalDate(1));
  const [checkOutDate, setCheckOutDate] = useState(() => createLocalDate(3));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [roomType, setRoomType] = useState<BookingRoomType>('deluxe-suite');
  const [paymentMethod, setPaymentMethod] = useState<BookingPaymentMethod>('credit-card');

  // Guest details — collected on the booking form
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState(user?.email || '');
  const [country, setCountry] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const discountReason = 'none';

  // Room categories fetched from the API
  const [roomCategories, setRoomCategories] = useState<RoomCategory[]>([]);
  const [isRoomCategoriesLoading, setIsRoomCategoriesLoading] = useState(true);
  const [roomCategoriesError, setRoomCategoriesError] = useState<string | null>(null);

  // The currently selected room category object (from API data)
  const selectedRoomCategory = roomCategories.find(
    (cat) => cat.id === roomType || normalizeToRoomType(cat.name) === roomType
  ) ?? null;

  const currentStatus: BookingViewState = bookingRequest?.status ?? 'idle';
  const statusTone = STATUS_TONES[currentStatus];
  const statusIndex = currentStatus === 'idle'
    ? -1
    : currentStatus === 'requested'
      ? 0
      : currentStatus === 'accepted'
        ? 1
        : currentStatus === 'paid'
          ? 2
          : 3;

  useEffect(() => {
    if (!propertyId) {
      setProperty(null);
      setPropertyError('Missing property identifier.');
      setIsPropertyLoading(false);
      return;
    }

    let isActive = true;

    const loadProperty = async () => {
      setIsPropertyLoading(true);
      setPropertyError('');

      try {
        const nextProperty = await fetchPropertyById(propertyId);

        if (!isActive) {
          return;
        }

        setProperty(nextProperty);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setProperty(null);
        setPropertyError(error instanceof Error ? error.message : 'Unable to load property details from the API.');
      } finally {
        if (isActive) {
          setIsPropertyLoading(false);
        }
      }
    };

    void loadProperty();

    return () => {
      isActive = false;
    };
  }, [propertyId]);

  // Fetch room categories from the API
  useEffect(() => {
    let isActive = true;
    setIsRoomCategoriesLoading(true);
    setRoomCategoriesError(null);

    fetchRoomCategories()
      .then((categories) => {
        if (!isActive) return;
        if (categories.length > 0) {
          setRoomCategories(categories);
          // Pre-select the first category if the current roomType is not in the API list
          const hasCurrentType = categories.some(
            (cat) => cat.id === roomType || normalizeToRoomType(cat.name) === roomType
          );
          if (!hasCurrentType) {
            const firstType = normalizeToRoomType(categories[0].name);
            setRoomType(firstType);
          }
        }
      })
      .catch((err) => {
        if (!isActive) return;
        setRoomCategoriesError(
          err instanceof Error ? err.message : 'Unable to load room categories.'
        );
      })
      .finally(() => {
        if (isActive) setIsRoomCategoriesLoading(false);
      });

    return () => {
      isActive = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Pre-fill name from auth user if fields are still empty
    const [firstWord = '', ...rest] = user.name.trim().split(' ');
    setGuestFirstName((current) => current || firstWord);
    setGuestLastName((current) => current || rest.join(' '));
    setGuestEmail((current) => current || user.email);
  }, [user]);

  useEffect(() => {
    if (currentStatus !== 'requested') {
      return;
    }

    const countdownId = window.setInterval(() => {
      setSecondsRemaining(current => {
        if (current <= 1) {
          window.clearInterval(countdownId);
          setBookingRequest(prev => (prev && prev.status === 'requested' ? { ...prev, status: 'declined' } : prev));
          setStatusMessage('The request expired before the partner completed the review.');
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(countdownId);
  }, [currentStatus]);

  useEffect(() => {
    if (currentStatus !== 'requested' || !bookingRequest) {
      return;
    }

    let isActive = true;
    const reviewId = window.setTimeout(async () => {
      setStatusMessage('Re-checking live availability against the partner inventory...');

      try {
        const result = await reviewBookingAvailability(bookingRequest.id);

        if (!isActive) {
          return;
        }

        setBookingRequest(result.booking);
        setStatusMessage(result.message);

        sendAdminPartnerAlert({
          bookingId: result.booking.id,
          property: property!,
          guestName: result.booking.guestName,
          guestEmail: result.booking.guestEmail,
          status: result.booking.status,
          booking: result.booking,
          message: result.message,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        setBookingRequest(prev => (prev && prev.status === 'requested' ? { ...prev, status: 'declined' } : prev));
        setStatusMessage(error instanceof Error ? error.message : 'Unable to review availability.');
      }
    }, 2600);

    return () => {
      isActive = false;
      window.clearTimeout(reviewId);
    };
  }, [currentStatus, bookingRequest, property]);

  const requestDraft = useMemo(() => {
    const safeCheckOutDate = checkOutDate || format(addDays(parseISO(checkInDate), 1), 'yyyy-MM-dd');

    if (!property) {
      return {
        nights: 0,
        guestCount: 1,
        roomRate: 0,
        roomTotal: 0,
        serviceFee: 0,
        discountAmount: 0,
        totalPrice: 0,
      };
    }

    // If we have a fetched room category with its own price, use it as the base rate
    // instead of the property price + multiplier so pricing reflects the API data.
    const propertyForPricing = selectedRoomCategory
      ? { ...property, price: selectedRoomCategory.defaultPrice }
      : property;

    return calculateBookingPricing(propertyForPricing, {
      checkInDate,
      checkOutDate: safeCheckOutDate,
      adults,
      children,
      infants,
      // Always send the canonical roomType enum value to the pricing helper so the
      // multiplier lookup still resolves (falls back to 1 for unknown keys).
      roomType,
      paymentMethod,
      discountReason,
    });
  }, [property, selectedRoomCategory, checkInDate, checkOutDate, adults, children, infants, roomType, paymentMethod, discountReason]);

  const activeDetails = bookingRequest ?? {
    checkInDate,
    checkOutDate,
    adults,
    children,
    infants,
    roomType,
    paymentMethod,
    nights: requestDraft.nights,
    guestCount: requestDraft.guestCount,
    roomRate: requestDraft.roomRate,
    serviceFee: requestDraft.serviceFee,
    discountAmount: requestDraft.discountAmount,
    totalPrice: requestDraft.totalPrice,
  };

  const activeRoom = ROOM_TYPE_OPTIONS[activeDetails.roomType];
  const activePayment = PAYMENT_METHOD_OPTIONS[activeDetails.paymentMethod];
  const formLocked = currentStatus !== 'idle';
  const showRequested = currentStatus === 'requested';
  const showAccepted = currentStatus === 'accepted';
  const showDeclined = currentStatus === 'declined';
  const showPaid = currentStatus === 'paid';

  const handleRequestBooking = async () => {
    if (!user || !property) {
      return;
    }

    const trimmedFirstName = guestFirstName.trim();
    const trimmedLastName = guestLastName.trim();
    const trimmedName = `${trimmedFirstName} ${trimmedLastName}`.trim();
    const trimmedEmail = guestEmail.trim();
    const trimmedCountry = country.trim();
    const trimmedPhone = guestPhone.trim();
    const trimmedSpecialRequests = specialRequests.trim();

    if (!checkInDate || !checkOutDate || parseISO(checkOutDate) <= parseISO(checkInDate)) {
      showToast({
        title: 'Complete the booking form',
        description: 'Please select valid check-in and check-out dates.',
        type: 'info',
      });
      return;
    }

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const PHONE_RE = /^[+\d\s()\-]{7,20}$/;

    if (!trimmedFirstName || trimmedFirstName.length < 1) {
      showToast({
        title: 'First name required',
        description: 'Please enter your first name.',
        type: 'info',
      });
      return;
    }

    if (!trimmedLastName || trimmedLastName.length < 1) {
      showToast({
        title: 'Last name required',
        description: 'Please enter your last name.',
        type: 'info',
      });
      return;
    }

    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      showToast({
        title: 'Valid email required',
        description: 'Please enter a valid email address.',
        type: 'info',
      });
      return;
    }

    if (!trimmedCountry || trimmedCountry.length < 2) {
      showToast({
        title: 'Country / region required',
        description: 'Please enter your country or region of residence.',
        type: 'info',
      });
      return;
    }

    if (!trimmedPhone || !PHONE_RE.test(trimmedPhone)) {
      showToast({
        title: 'Valid mobile number required',
        description: 'Please enter a valid mobile number (digits, spaces, + and - allowed).',
        type: 'info',
      });
      return;
    }

    if (adults < 1) {
      showToast({
        title: 'Guest count required',
        description: 'At least 1 adult guest is required.',
        type: 'info',
      });
      return;
    }

    const localDraft = createBookingRequest(property, trimmedName, trimmedEmail, {
      checkInDate,
      checkOutDate,
      adults,
      children,
      infants,
      roomType,
      paymentMethod,
      discountReason,
    });

    setIsBookingSubmitting(true);
    setStatusMessage('Sending your booking request to the API...');

    try {
      const request = await createBookingRequestApi({
        propertyId: property.id,
        propertyName: property.name,
        guestName: trimmedName,
        guestEmail: trimmedEmail,
        guestPhone: trimmedPhone,
        checkInDate,
        checkOutDate,
        adults,
        children,
        infants,
        roomType,
        paymentMethod,
        discountReason: undefined,
        discountAmount: 0,
        specialRequests: trimmedSpecialRequests || undefined,
      });

      const normalizedRequest: BookingRequest = {
        ...request,
        id: String(request.id),
        propertyId: String(request.propertyId ?? property.id),
        propertyName: request.propertyName ?? property.name,
        guestName: request.guestName ?? user.name,
        guestEmail: request.guestEmail ?? user.email,
        checkInDate: request.checkInDate ?? checkInDate,
        checkOutDate: request.checkOutDate ?? checkOutDate,
        adults: request.adults ?? adults,
        children: request.children ?? children,
        infants: request.infants ?? infants,
        roomType: request.roomType ?? roomType,
        paymentMethod: request.paymentMethod ?? paymentMethod,
        nights: request.nights ?? localDraft.nights,
        guestCount: request.guestCount ?? localDraft.guestCount,
        roomRate: request.roomRate ?? localDraft.roomRate,
        serviceFee: request.serviceFee ?? localDraft.serviceFee,
        totalPrice: request.totalPrice ?? localDraft.totalPrice,
        guestPhone: request.guestPhone ?? trimmedPhone,
        discountAmount: request.discountAmount ?? localDraft.discountAmount,
        discountReason: request.discountReason ?? (discountReason === 'none' ? undefined : discountReason),
      };

      setBookingRequest(normalizedRequest);
      setSecondsRemaining(BOOKING_REQUEST_EXPIRY_SECONDS);
      setIsPaymentProcessing(false);
      setStatusMessage('Request sent. The partner is reviewing live availability now.');

      // Immediately reflect the new booking in the shared BookingsContext so
      // My Bookings shows it without requiring a page refresh.
      appendBooking(normalizedRequest);

      trackBookingRequested({
        bookingId: normalizedRequest.id,
        property,
        guestName: normalizedRequest.guestName,
        guestEmail: normalizedRequest.guestEmail,
        booking: {
          checkInDate: normalizedRequest.checkInDate,
          checkOutDate: normalizedRequest.checkOutDate,
          adults: normalizedRequest.adults,
          children: normalizedRequest.children,
          infants: normalizedRequest.infants,
          roomType: normalizedRequest.roomType,
          paymentMethod: normalizedRequest.paymentMethod,
          nights: normalizedRequest.nights,
          guestCount: normalizedRequest.guestCount,
          totalPrice: normalizedRequest.totalPrice,
        },
      });

      sendAdminPartnerAlert({
        bookingId: normalizedRequest.id,
        property,
        guestName: normalizedRequest.guestName,
        guestEmail: normalizedRequest.guestEmail,
        status: 'requested',
        booking: {
          checkInDate: normalizedRequest.checkInDate,
          checkOutDate: normalizedRequest.checkOutDate,
          adults: normalizedRequest.adults,
          children: normalizedRequest.children,
          infants: normalizedRequest.infants,
          roomType: normalizedRequest.roomType,
          paymentMethod: normalizedRequest.paymentMethod,
          nights: normalizedRequest.nights,
          guestCount: normalizedRequest.guestCount,
          totalPrice: normalizedRequest.totalPrice,
        },
        message: 'New request-to-book entry received from the website.',
      });

      showToast({
        title: 'Request sent',
        description: 'We are re-checking availability with the partner now.',
        type: 'info',
      });
    } catch (error) {
      setBookingRequest(null);

      // Extract the HTTP status code from the axios error so we can give
      // the user a specific, actionable message.
      const statusCode = isAxiosError(error) ? error.response?.status : undefined;
      const serverMessage = isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : undefined;

      if (statusCode === 409) {
        // The server found a date overlap with an existing booking.
        const msg = serverMessage ?? 'The selected dates are already booked for this property.';
        setStatusMessage(`${msg} Please choose different check-in or check-out dates.`);
        showToast({
          title: 'Dates unavailable',
          description: 'These dates overlap with an existing booking. Please select different dates.',
          type: 'info',
        });
      } else if (statusCode === 308 || statusCode === 301 || statusCode === 302) {
        // The API URL has a redirect configured. This is a configuration issue —
        // the frontend is hitting the server directly instead of via the Vite proxy.
        setStatusMessage('Network configuration error. Please reload the page and try again.');
        showToast({
          title: 'Connection error',
          description: 'The booking API returned a redirect. Please reload the page and try again.',
          type: 'info',
        });
      } else {
        const fallbackMsg = serverMessage ?? (error instanceof Error ? error.message : 'The booking API could not be reached.');
        setStatusMessage('Unable to send the booking request. Please try again.');
        showToast({
          title: 'Request failed',
          description: fallbackMsg,
          type: 'info',
        });
      }
    } finally {
      setIsBookingSubmitting(false);
    }
  };

  const handleProceedToPayment = () => {
    if (!bookingRequest || currentStatus !== 'accepted' || !property) {
      return;
    }

    const requestSnapshot = bookingRequest;
    setIsPaymentProcessing(true);
    setBookingRequest(prev => (prev ? { ...prev, status: 'paid' } : prev));
    setStatusMessage(`Payment authorization is processing now using ${activePayment.label}.`);
    void updateBookingRequestApi(requestSnapshot.id, { status: 'paid', paymentMethod: requestSnapshot.paymentMethod });

    window.setTimeout(() => {
      setBookingRequest(prev => (prev ? { ...prev, status: 'confirmed' } : prev));
      setIsPaymentProcessing(false);
      setStatusMessage('Booking confirmed. Confirmation emails have been dispatched.');
      void updateBookingRequestApi(requestSnapshot.id, {
        status: 'confirmed',
        paymentMethod: requestSnapshot.paymentMethod,
      });

      sendEmailConfirmation({
        bookingId: requestSnapshot.id,
        property,
        guestName: requestSnapshot.guestName,
        guestEmail: requestSnapshot.guestEmail,
        status: 'confirmed',
        booking: requestSnapshot,
        message: `Your booking request has been confirmed and paid using ${activePayment.label}.`,
      });

      sendAdminPartnerAlert({
        bookingId: requestSnapshot.id,
        property,
        guestName: requestSnapshot.guestName,
        guestEmail: requestSnapshot.guestEmail,
        status: 'confirmed',
        booking: requestSnapshot,
        message: `Payment captured using ${activePayment.label} and the booking has been confirmed.`,
      });

      showToast({
        title: 'Booking confirmed!',
        description: `Your stay at ${property.name} is confirmed.`,
        type: 'success',
      });

      window.setTimeout(() => {
        navigate('/');
      }, 3500);
    }, BOOKING_PAYMENT_PROCESSING_MS);
  };

  const handleReturnHome = () => {
    navigate('/');
  };

  const primaryButtonLabel = (() => {
    if (isBookingSubmitting) return 'Sending request...';
    if (showAccepted) return 'Confirm booking';
    if (showRequested) return `Request expires in ${formatCountdown(secondsRemaining)}`;
    if (showPaid) return 'Processing payment';
    if (showDeclined) return 'Return to collection';
    return 'Request to Book';
  })();

  const primaryButtonAction = (() => {
    if (showAccepted) return handleProceedToPayment;
    if (showDeclined) return handleReturnHome;
    if (showRequested || showPaid) return undefined;
    return handleRequestBooking;
  })();

  const primaryButtonDisabled = showRequested || showPaid || isBookingSubmitting;

  if (!user) {
    return <Navigate to="/" replace state={{ openAuthModal: true }} />;
  }

  if (isPropertyLoading) {
    return (
      <div className="min-h-screen pt-32 bg-brand-background flex items-center justify-center p-4">
        <div className="bg-brand-cream p-10 rounded-[2rem] shadow-md max-w-lg w-full text-center border border-brand-primary/10">
          <Loader2 className="w-10 h-10 text-brand-primary animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-serif font-bold text-brand-dark mb-2">Loading property</h2>
          <p className="text-sm font-bold text-brand-dark/70">Fetching the latest room details from the API.</p>
        </div>
      </div>
    );
  }

  if (propertyError || !property) {
    return (
      <div className="min-h-screen pt-32 bg-brand-background flex items-center justify-center p-4">
        <div className="bg-brand-cream p-10 rounded-[2rem] shadow-md max-w-lg w-full text-center border border-red-200">
          <AlertTriangle className="w-10 h-10 text-red-600 mx-auto mb-4" />
          <h2 className="text-2xl font-serif font-bold text-brand-dark mb-2">Unable to load property</h2>
          <p className="text-sm font-bold text-brand-dark/70 mb-6">{propertyError || 'Property not found.'}</p>
          <button type="button" onClick={() => navigate('/')} className="px-8 py-3 bg-brand-primary text-brand-cream text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-brand-hover transition-all active:scale-95 shadow-md w-full">
            Return Home
          </button>
        </div>
      </div>
    );
  }

  if (currentStatus === 'confirmed') {
    return (
      <div className="min-h-screen pt-32 bg-brand-background flex items-center justify-center p-4">
        <div className="bg-brand-cream p-12 rounded-[2rem] shadow-md max-w-xl w-full text-center border border-brand-primary/10">
          <div className="w-20 h-20 bg-brand-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-brand-primary" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-3">Payment complete</p>
          <h2 className="text-3xl font-serif font-bold text-brand-dark mb-4">Booking Confirmed</h2>
          <p className="text-brand-dark font-sans font-bold mb-8 leading-relaxed">
            Your request for <strong className="text-brand-primary">{property.name}</strong> is fully confirmed.
            We sent the receipt and stay details to {user?.email}.
          </p>
          <button
            type="button"
            onClick={handleReturnHome}
            className="px-8 py-3 bg-brand-primary text-brand-cream text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-brand-hover transition-all active:scale-95 shadow-md w-full"
          >
            Return to Collection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-32 bg-brand-background pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-brand-dark/60 hover:text-brand-primary font-bold text-xs uppercase tracking-widest mb-8 transition-colors active:scale-95"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Go Back</span>
        </button>

        <div className="bg-brand-cream rounded-[2rem] p-8 md:p-12 shadow-md border border-brand-primary/10">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8 border-b border-brand-primary/10 pb-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">Request to Book</p>
              <h1 className="text-4xl font-serif font-bold text-brand-dark mb-3">{property.name}</h1>
              <p className="text-sm font-bold text-brand-dark/70">{property.location}</p>
            </div>

            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-[10px] font-bold uppercase tracking-widest ${statusTone.className}`}>
              {renderStatusIcon(currentStatus)}
              <span>{statusTone.label}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-10">
            <div className="space-y-6">
              <section className="rounded-3xl border border-brand-primary/10 bg-brand-cream p-6 shadow-sm">
                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">Booking details</p>
                  <h3 className="text-2xl font-serif font-bold text-brand-dark">Guest &amp; stay information</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Row 1: First Name + Last Name */}
                  <div>
                    <label htmlFor="guest-first-name" className="block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">First Name</label>
                    <input
                      id="guest-first-name"
                      type="text"
                      required
                      disabled={formLocked}
                      value={guestFirstName}
                      onChange={(e) => setGuestFirstName(e.target.value)}
                      className="w-full rounded-xl border border-brand-primary/20 bg-brand-background/50 px-4 py-3 text-sm text-brand-dark focus:border-brand-primary focus:outline-none disabled:opacity-50"
                      placeholder="e.g. Maria"
                    />
                  </div>
                  <div>
                    <label htmlFor="guest-last-name" className="block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">Last Name</label>
                    <input
                      id="guest-last-name"
                      type="text"
                      required
                      disabled={formLocked}
                      value={guestLastName}
                      onChange={(e) => setGuestLastName(e.target.value)}
                      className="w-full rounded-xl border border-brand-primary/20 bg-brand-background/50 px-4 py-3 text-sm text-brand-dark focus:border-brand-primary focus:outline-none disabled:opacity-50"
                      placeholder="e.g. Santos"
                    />
                  </div>

                  {/* Row 2: Email (full-width) */}
                  <div className="md:col-span-2">
                    <label htmlFor="guest-email" className="block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">Email</label>
                    <input
                      id="guest-email"
                      type="email"
                      required
                      disabled={formLocked}
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      className="w-full rounded-xl border border-brand-primary/20 bg-brand-background/50 px-4 py-3 text-sm text-brand-dark focus:border-brand-primary focus:outline-none disabled:opacity-50"
                      placeholder="you@example.com"
                    />
                  </div>

                  {/* Row 3: Country/Region + Mobile Number */}
                  <div>
                    <label htmlFor="guest-country" className="block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">Country / Region of Residence</label>
                    <input
                      id="guest-country"
                      type="text"
                      required
                      disabled={formLocked}
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full rounded-xl border border-brand-primary/20 bg-brand-background/50 px-4 py-3 text-sm text-brand-dark focus:border-brand-primary focus:outline-none disabled:opacity-50"
                      placeholder="e.g. Philippines"
                    />
                  </div>
                  <div>
                    <label htmlFor="guest-phone" className="block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">Mobile Number</label>
                    <input
                      id="guest-phone"
                      type="tel"
                      required
                      disabled={formLocked}
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      className="w-full rounded-xl border border-brand-primary/20 bg-brand-background/50 px-4 py-3 text-sm text-brand-dark focus:border-brand-primary focus:outline-none disabled:opacity-50"
                      placeholder="+63 9XX XXX XXXX"
                    />
                  </div>

                  {/* Row 4: Special Request (full-width textarea) */}
                  <div className="md:col-span-2">
                    <label htmlFor="guest-special-requests" className="block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">
                      Special Request <span className="normal-case font-normal text-brand-dark/40">(optional)</span>
                    </label>
                    <textarea
                      id="guest-special-requests"
                      rows={3}
                      disabled={formLocked}
                      value={specialRequests}
                      onChange={(e) => setSpecialRequests(e.target.value)}
                      maxLength={500}
                      className="w-full rounded-xl border border-brand-primary/20 bg-brand-background/50 px-4 py-3 text-sm text-brand-dark focus:border-brand-primary focus:outline-none disabled:opacity-50 resize-none"
                      placeholder="Early check-in, dietary needs, accessibility requirements…"
                    />
                    <p className="text-[10px] font-bold text-brand-dark/30 mt-1 text-right">{specialRequests.length}/500</p>
                  </div>

                  {/* Row 5: Check-in + Check-out dates */}
                  <div>
                    <label htmlFor="check-in-date" className="block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">Check-in date</label>
                    <input
                      id="check-in-date"
                      type="date"
                      required
                      disabled={formLocked}
                      min={createLocalDate(0)}
                      value={checkInDate}
                      onChange={(e) => {
                        const nextCheckIn = e.target.value;
                        setCheckInDate(nextCheckIn);
                        if (checkOutDate && parseISO(checkOutDate) <= parseISO(nextCheckIn)) {
                          setCheckOutDate(format(addDays(parseISO(nextCheckIn), 1), 'yyyy-MM-dd'));
                        }
                      }}
                      className="w-full rounded-xl border border-brand-primary/20 bg-brand-background/50 px-4 py-3 text-sm text-brand-dark focus:border-brand-primary focus:outline-none disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="check-out-date" className="block text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">Check-out date</label>
                    <input
                      id="check-out-date"
                      type="date"
                      required
                      disabled={formLocked}
                      min={checkInDate ? format(addDays(parseISO(checkInDate), 1), 'yyyy-MM-dd') : createLocalDate(1)}
                      value={checkOutDate}
                      onChange={(e) => setCheckOutDate(e.target.value)}
                      className="w-full rounded-xl border border-brand-primary/20 bg-brand-background/50 px-4 py-3 text-sm text-brand-dark focus:border-brand-primary focus:outline-none disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl border border-brand-primary/10 bg-brand-background/80 p-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">Duration</p>
                    <p className="text-xl font-serif font-bold text-brand-dark">
                      {requestDraft.nights} night{requestDraft.nights === 1 ? '' : 's'}
                    </p>
                    <p className="text-xs font-bold text-brand-dark/60 mt-1">
                      {formatDisplayDate(checkInDate)} &ndash; {formatDisplayDate(checkOutDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 mb-1">Estimated</p>
                    <p className="text-xl font-serif font-bold text-brand-primary">
                      ₱{requestDraft.totalPrice.toLocaleString()}
                    </p>
                    <p className="text-xs font-bold text-brand-dark/60 mt-1">Room rate, guests &amp; service fee included</p>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-brand-primary/10 bg-brand-cream p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">Guest details</p>
                    <h3 className="text-2xl font-serif font-bold text-brand-dark">Who is coming?</h3>
                  </div>
                  <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-brand-dark/60">
                    <Users className="w-4 h-4" />
                    <span>{activeDetails.guestCount} guests</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { label: 'Adults', value: adults, setter: setAdults, hint: '18 years and above' },
                    { label: 'Children', value: children, setter: setChildren, hint: '3 to 17 years old' },
                    { label: 'Infants', value: infants, setter: setInfants, hint: 'Under 2 years old' },
                  ].map(item => (
                    <div key={item.label} className="rounded-2xl border border-brand-primary/10 bg-brand-background/70 p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50">{item.label}</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => item.setter(Math.max(0, item.value - 1))}
                            disabled={formLocked}
                            className="h-8 w-8 rounded-full border border-brand-primary/10 bg-brand-cream text-brand-dark hover:bg-brand-primary hover:text-brand-cream disabled:opacity-40"
                          >
                            -
                          </button>
                          <span className="w-8 text-center text-lg font-serif font-bold text-brand-dark">{item.value}</span>
                          <button
                            type="button"
                            onClick={() => item.setter(item.value + 1)}
                            disabled={formLocked || item.value >= 8}
                            className="h-8 w-8 rounded-full border border-brand-primary/10 bg-brand-cream text-brand-dark hover:bg-brand-primary hover:text-brand-cream disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <p className="text-xs font-bold text-brand-dark/60 leading-relaxed">{item.hint}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-brand-primary/10 bg-brand-cream p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">Room selection</p>
                    <h3 className="text-2xl font-serif font-bold text-brand-dark">Choose your room</h3>
                  </div>
                </div>

                {isRoomCategoriesLoading ? (
                  <div className="flex items-center justify-center gap-3 py-8 text-brand-dark/60">
                    <Loader2 className="w-5 h-5 animate-spin text-brand-primary" />
                    <p className="text-sm font-bold uppercase tracking-widest">Loading room categories…</p>
                  </div>
                ) : roomCategoriesError ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-amber-800 mb-1">Could not load room categories from the API</p>
                      <p className="text-xs font-bold text-amber-700/80 leading-relaxed">{roomCategoriesError} — showing default options below.</p>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-3">
                  {(roomCategories.length > 0 ? roomCategories : []).map((cat) => {
                    const canonicalType = normalizeToRoomType(cat.name);
                    const isSelected = roomType === canonicalType || roomType === cat.id;

                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setRoomType(canonicalType)}
                        disabled={formLocked || isRoomCategoriesLoading}
                        className={`rounded-2xl border p-4 text-left transition-all disabled:opacity-60 ${isSelected ? 'border-brand-primary bg-brand-primary/10' : 'border-brand-primary/10 bg-brand-background/70 hover:border-brand-primary/30 hover:bg-brand-background'}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-bold uppercase tracking-widest text-brand-dark mb-1">{cat.name}</p>
                            <p className="text-xs font-bold text-brand-dark/60 leading-relaxed">{cat.description || ROOM_TYPE_OPTIONS[canonicalType]?.description}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/40">From</p>
                            <p className="text-sm font-serif font-bold text-brand-primary">₱{cat.defaultPrice.toLocaleString()}</p>
                            <p className="text-[10px] font-bold text-brand-dark/40 mt-0.5">/ night</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {/* Fallback to static options if API returned nothing and is done loading */}
                  {!isRoomCategoriesLoading && roomCategories.length === 0 && ROOM_ORDER.map(option => {
                    const config = ROOM_TYPE_OPTIONS[option];
                    const isSelected = roomType === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setRoomType(option)}
                        disabled={formLocked}
                        className={`rounded-2xl border p-4 text-left transition-all disabled:opacity-60 ${isSelected ? 'border-brand-primary bg-brand-primary/10' : 'border-brand-primary/10 bg-brand-background/70 hover:border-brand-primary/30 hover:bg-brand-background'}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-bold uppercase tracking-widest text-brand-dark mb-1">{config.label}</p>
                            <p className="text-xs font-bold text-brand-dark/60 leading-relaxed">{config.description}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/40">Tier</p>
                            <p className="text-sm font-serif font-bold text-brand-primary">x{config.multiplier.toFixed(2)}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-3xl border border-brand-primary/10 bg-brand-cream p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">Payment options</p>
                    <h3 className="text-2xl font-serif font-bold text-brand-dark">How do you want to pay?</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {PAYMENT_ORDER.map(option => {
                    const config = PAYMENT_METHOD_OPTIONS[option];
                    const isSelected = paymentMethod === option;
                    const Icon = option === 'credit-card' ? CreditCard : option === 'gcash' ? Smartphone : Landmark;

                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setPaymentMethod(option)}
                        disabled={formLocked}
                        className={`rounded-2xl border p-4 text-left transition-all disabled:opacity-60 ${isSelected ? 'border-brand-primary bg-brand-primary/10' : 'border-brand-primary/10 bg-brand-background/70 hover:border-brand-primary/30 hover:bg-brand-background'}`}
                      >
                        <Icon className="w-5 h-5 text-brand-primary mb-3" />
                        <p className="text-sm font-bold uppercase tracking-widest text-brand-dark mb-1">{config.label}</p>
                        <p className="text-xs font-bold text-brand-dark/60 leading-relaxed">{config.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section className="rounded-3xl border border-brand-primary/10 bg-brand-cream p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">Booking summary</p>
                <h3 className="text-2xl font-serif font-bold text-brand-dark mb-5">Your selected stay</h3>

                <div className="space-y-4">
                  <SummaryRow label="Check-in" value={formatDisplayDate(activeDetails.checkInDate)} />
                  <SummaryRow label="Check-out" value={formatDisplayDate(activeDetails.checkOutDate)} />
                  <SummaryRow label="Duration" value={`${activeDetails.nights} nights`} />
                  <SummaryRow label="Guests" value={`${activeDetails.adults} adults, ${activeDetails.children} children, ${activeDetails.infants} infants`} />
                  <SummaryRow label="Room" value={activeRoom.label} />
                  <SummaryRow label="Payment" value={activePayment.label} />
                </div>

                <div className="mt-6 rounded-2xl bg-brand-background/80 border border-brand-primary/10 p-4">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-brand-dark/50 mb-1">Estimated</p>
                  <p className="text-3xl font-serif font-bold text-brand-primary">₱{activeDetails.totalPrice.toLocaleString()}</p>
                  <p className="text-xs font-bold text-brand-dark/60 mt-2 leading-relaxed">This estimate includes the selected room tier and service fee.</p>
                </div>
              </section>

              <section className="rounded-3xl border border-brand-primary/10 bg-brand-cream p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">Payment summary</p>
                <h3 className="text-2xl font-serif font-bold text-brand-dark mb-5">Review before confirm</h3>

                <div className="space-y-3 text-sm font-bold text-brand-dark/80">
                  <SummaryRow label="Room subtotal" value={`₱${activeDetails.roomRate.toLocaleString()} / night`} />
                  <SummaryRow label="Service fee" value={`₱${activeDetails.serviceFee.toLocaleString()}`} />
                  {activeDetails.discountAmount > 0 && (
                    <SummaryRow label="Discount" value={`-₱${activeDetails.discountAmount.toLocaleString()}`} />
                  )}
                  <SummaryRow label="Payment method" value={activePayment.label} />
                  <SummaryRow label="Estimated" value={`₱${activeDetails.totalPrice.toLocaleString()}`} emphasis />
                </div>
              </section>

              <section className="rounded-3xl border border-brand-primary/10 bg-brand-cream p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-brand-dark/50">Booking timeline</p>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/40">Requested &rarr; Accepted &rarr; Paid &rarr; Confirmed</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                  {BOOKING_STEPS.map((step, index) => {
                    const isComplete = currentStatus !== 'idle' && (showDeclined ? index === 0 : index <= statusIndex);
                    const isCurrent = currentStatus !== 'idle' && index === statusIndex && !showDeclined;
                    const isDeclined = showDeclined && index === 0;

                    return (
                      <div key={step.status} className="flex flex-col items-center gap-2 text-center min-w-0">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center border text-[10px] font-bold transition-colors shrink-0 ${
                            isDeclined
                              ? 'bg-red-100 text-red-900 border-red-200'
                              : isCurrent
                                ? 'bg-brand-primary text-brand-cream border-brand-primary'
                                : isComplete
                                  ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/20'
                                  : 'bg-brand-background text-brand-dark/30 border-brand-primary/10'
                          }`}
                        >
                          {index + 1}
                        </div>
                        <p className={`text-[10px] font-bold uppercase tracking-widest break-words ${isCurrent || isComplete || isDeclined ? 'text-brand-dark' : 'text-brand-dark/40'}`}>
                          {step.label}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {showDeclined ? (
                  <div className="rounded-2xl bg-red-50 border border-red-100 p-4 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-red-700 mb-1">Request declined</p>
                      <p className="text-xs font-bold text-red-700/80 leading-relaxed">{statusMessage}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-brand-background/80 border border-brand-primary/10 p-4">
                    <div className="flex items-start gap-3">
                      {showRequested ? (
                        <RefreshCw className="w-5 h-5 text-brand-primary mt-0.5 animate-spin" />
                      ) : showAccepted ? (
                        <ShieldCheck className="w-5 h-5 text-brand-primary mt-0.5" />
                      ) : showPaid ? (
                        <Loader2 className="w-5 h-5 text-brand-primary mt-0.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-5 h-5 text-brand-primary mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-bold text-brand-dark mb-1">{statusMessage}</p>
                        {showRequested && bookingRequest && (
                          <p className="text-xs font-bold text-brand-dark/60 uppercase tracking-widest">Expires in {formatCountdown(secondsRemaining)}</p>
                        )}
                        {showAccepted && (
                          <p className="text-xs font-bold text-brand-dark/60 uppercase tracking-widest">Availability is reserved until you confirm the booking.</p>
                        )}
                        {showPaid && (
                          <p className="text-xs font-bold text-brand-dark/60 uppercase tracking-widest">Final confirmation is being processed now.</p>
                        )}
                      </div>
                    </div>

                    {showRequested && (
                      <div className="mt-4 h-2 rounded-full bg-brand-secondary/20 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-brand-primary transition-all duration-300"
                          style={{ width: `${100 - (secondsRemaining / BOOKING_REQUEST_EXPIRY_SECONDS) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>

              <div className="space-y-3">
                {!showRequested && !showAccepted && !showPaid && !showDeclined && (
                  <p className="text-xs font-bold text-brand-dark/60 leading-relaxed">
                    The schedule, guest mix, room type, and payment method are ready. Submit the request when you are set.
                  </p>
                )}

                {showRequested && (
                  <p className="text-xs font-bold text-brand-dark/60 leading-relaxed">
                    We are waiting on a live partner response. You do not need to refresh the page.
                  </p>
                )}

                {showAccepted && (
                  <p className="text-xs font-bold text-brand-dark/60 leading-relaxed">
                    Availability is confirmed. Confirm booking to process payment and finalize the stay.
                  </p>
                )}

                <button
                  type="button"
                  onClick={primaryButtonAction}
                  disabled={primaryButtonDisabled || isPaymentProcessing}
                  className={`w-full px-8 py-4 text-xs font-bold uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-md flex justify-center items-center gap-2 ${
                    showDeclined
                      ? 'bg-brand-dark text-brand-cream hover:bg-brand-hover'
                      : showRequested || showPaid
                        ? 'bg-brand-primary text-brand-cream opacity-70 cursor-not-allowed'
                        : 'bg-brand-primary text-brand-cream hover:bg-brand-hover'
                  }`}
                >
                  {showRequested || showPaid ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{primaryButtonLabel}</span>
                    </>
                  ) : (
                    <span>{primaryButtonLabel}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
