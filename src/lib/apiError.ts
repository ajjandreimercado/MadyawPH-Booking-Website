/**
 * Maps raw API / network errors to guest-friendly copy.
 */

const MESSAGE_MAP: Record<string, string> = {
  'Invalid or expired receipt token.': 'This confirmation link has expired. Please use the link from your booking email.',
  'Authentication required. Please open your confirmation link with a valid receipt token.':
    'Please open the full confirmation link from your booking email.',
  'Access denied. Invalid receipt token for this booking.':
    'This confirmation link does not match this booking.',
  'Access denied. Sign in or provide a valid receipt token to start payment.':
    'Please open your booking confirmation link to pay.',
  'Unexpected server error.': 'Something went wrong on our end. Please try again in a moment.',
  'Route not found.': 'That page or action is not available.',
};

const TECHNICAL_PATTERNS: RegExp[] = [
  /\bapi\b/i,
  /\btoken\b/i,
  /\bwebhook\b/i,
  /\bendpoint\b/i,
  /\bbase64\b/i,
  /\bmongo/i,
  /\bobjectid\b/i,
  /\bstatus code\b/i,
  /\benv\b/i,
  /\bjson\b/i,
  /\baxios\b/i,
  /\bnetwork error\b/i,
  /must be a string/i,
  /must be one of:/i,
  /propertyId/i,
  /checkInDate/i,
  /HOTEL_WEBHOOK/i,
];

export function humanizeApiError(message: string | undefined | null, fallback?: string): string {
  const trimmed = (message ?? '').trim();
  if (!trimmed) {
    return fallback ?? 'Something went wrong. Please try again.';
  }

  if (MESSAGE_MAP[trimmed]) {
    return MESSAGE_MAP[trimmed];
  }

  if (TECHNICAL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return fallback ?? 'Something went wrong. Please check your details and try again.';
  }

  return trimmed;
}

export function errorMessageFromUnknown(error: unknown, fallback?: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: string } } }).response?.data;
    if (data?.message) {
      return humanizeApiError(data.message, fallback);
    }
  }

  if (error instanceof Error) {
    return humanizeApiError(error.message, fallback);
  }

  return fallback ?? 'Something went wrong. Please try again.';
}
