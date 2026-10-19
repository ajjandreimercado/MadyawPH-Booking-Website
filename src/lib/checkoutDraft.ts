/**
 * Checkout progress per room, saved in sessionStorage so Back, refresh and the
 * "Your details" ⇄ "Finish booking" steps keep what the guest typed.
 * The valid ID file can't be stored there, so it stays in memory for this tab only.
 */

export interface CheckoutDraft {
  fullName: string;
  email: string;
  phone: string;
  nationality: string;
  bookingForSomeoneElse: boolean;
  stayGuestName: string;
  /** Estimated arrival as HH:mm (hotel app check_in_time), '' when unknown. */
  arrivalTime: string;
  specialRequests: string;
  /** Reference number from the guest's GCash/Maya receipt. */
  paymentRef: string;
  /** Amount the guest paid (from the receipt), as typed — '' until they enter it. */
  paymentAmountPaid: string;
  malePax: number;
  femalePax: number;
  discountType: string;
  promoCode: string;
  membershipId: string;
}

export const EMPTY_DRAFT: CheckoutDraft = {
  fullName: '',
  email: '',
  phone: '',
  nationality: 'Filipino',
  bookingForSomeoneElse: false,
  stayGuestName: '',
  arrivalTime: '',
  specialRequests: '',
  paymentRef: '',
  paymentAmountPaid: '',
  malePax: 0,
  femalePax: 0,
  discountType: '',
  promoCode: '',
  membershipId: '',
};

/** Arrival windows; the value (window start, HH:mm) goes to the hotel app. */
export const ARRIVAL_SLOTS = [
  { value: '14:00', label: '2:00 PM – 3:00 PM' },
  { value: '15:00', label: '3:00 PM – 4:00 PM' },
  { value: '16:00', label: '4:00 PM – 5:00 PM' },
  { value: '17:00', label: '5:00 PM – 6:00 PM' },
  { value: '18:00', label: '6:00 PM – 7:00 PM' },
  { value: '19:00', label: '7:00 PM – 8:00 PM' },
  { value: '20:00', label: '8:00 PM – 9:00 PM' },
  { value: '21:00', label: '9:00 PM – 10:00 PM' },
  { value: '22:00', label: '10:00 PM – 11:00 PM' },
  { value: '23:00', label: '11:00 PM – 12:00 AM' },
  { value: '00:00', label: 'After midnight' },
];

export function arrivalLabel(value: string): string {
  return ARRIVAL_SLOTS.find((slot) => slot.value === value)?.label ?? '';
}

const key = (propertyId: string) => `madyaw_checkout_${propertyId}`;
const validIds = new Map<string, File>();
const paymentProofs = new Map<string, File>();

export function loadDraft(propertyId: string): CheckoutDraft {
  try {
    const raw = sessionStorage.getItem(key(propertyId));
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<CheckoutDraft>) } : { ...EMPTY_DRAFT };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function saveDraft(propertyId: string, draft: CheckoutDraft): void {
  try {
    sessionStorage.setItem(key(propertyId), JSON.stringify(draft));
  } catch {
    // private mode / quota — the form still works, it just won't survive a refresh
  }
}

export function clearDraft(propertyId: string): void {
  validIds.delete(propertyId);
  paymentProofs.delete(propertyId);
  try {
    sessionStorage.removeItem(key(propertyId));
  } catch {
    // ignore
  }
}

export function getValidId(propertyId: string): File | null {
  return validIds.get(propertyId) ?? null;
}

export function setValidId(propertyId: string, file: File | null): void {
  if (file) validIds.set(propertyId, file);
  else validIds.delete(propertyId);
}

export function getPaymentProof(propertyId: string): File | null {
  return paymentProofs.get(propertyId) ?? null;
}

export function setPaymentProof(propertyId: string, file: File | null): void {
  if (file) paymentProofs.set(propertyId, file);
  else paymentProofs.delete(propertyId);
}

/** Everything the hotel needs that has no field of its own goes into special_requests (max 500). */
export function buildSpecialRequests(draft: CheckoutDraft, validIdName: string): string {
  return [
    `Valid ID uploaded: ${validIdName}`,
    draft.bookingForSomeoneElse && draft.stayGuestName.trim() ? `Guest staying: ${draft.stayGuestName.trim()}` : '',
    draft.nationality !== 'Filipino' ? `Nationality: ${draft.nationality}` : '',
    draft.arrivalTime ? `Estimated arrival: ${arrivalLabel(draft.arrivalTime) || draft.arrivalTime}` : '',
    draft.malePax || draft.femalePax ? `Demographics: ${draft.malePax}M / ${draft.femalePax}F` : '',
    'Payment: full stay paid by QR at booking (screenshot attached)',
    draft.specialRequests.trim() ? `Requests: ${draft.specialRequests.trim()}` : '',
  ].filter(Boolean).join(' | ').slice(0, 500);
}
