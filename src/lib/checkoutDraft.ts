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
  arrivalTime: string;
  specialRequests: string;
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
  malePax: 0,
  femalePax: 0,
  discountType: '',
  promoCode: '',
  membershipId: '',
};

const key = (propertyId: string) => `madyaw_checkout_${propertyId}`;
const validIds = new Map<string, File>();

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

/** Everything the hotel needs that has no field of its own goes into special_requests (max 500). */
export function buildSpecialRequests(draft: CheckoutDraft, validIdName: string): string {
  return [
    `Valid ID uploaded: ${validIdName}`,
    draft.bookingForSomeoneElse && draft.stayGuestName.trim() ? `Guest staying: ${draft.stayGuestName.trim()}` : '',
    draft.nationality !== 'Filipino' ? `Nationality: ${draft.nationality}` : '',
    draft.arrivalTime ? `Estimated arrival: ${draft.arrivalTime}` : '',
    draft.malePax || draft.femalePax ? `Demographics: ${draft.malePax}M / ${draft.femalePax}F` : '',
    'Payment: full stay after hotel confirmation',
    draft.specialRequests.trim() ? `Requests: ${draft.specialRequests.trim()}` : '',
  ].filter(Boolean).join(' | ').slice(0, 500);
}
