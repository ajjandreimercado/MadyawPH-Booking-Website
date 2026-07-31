/**
 * Payment checkout provider abstraction.
 *
 * Production-safe defaults:
 * - If XENDIT_SECRET_KEY is not configured, checkout stays unavailable and
 *   bookings continue to work as reservation requests (no fake paid state).
 * - When the key is present, this creates an Xendit Invoice and returns a URL.
 */

export interface PaymentCheckoutRequest {
  bookingId: string;
  bookingReference?: string;
  amount: number;
  currency?: string;
  guestEmail: string;
  guestName: string;
  description: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

export interface PaymentCheckoutResponse {
  enabled: boolean;
  mode: 'live' | 'unavailable';
  checkoutUrl?: string;
  externalId?: string;
  message: string;
}

function getXenditSecret() {
  return (process.env.XENDIT_SECRET_KEY ?? '').trim();
}

export function isOnlinePaymentEnabled() {
  return Boolean(getXenditSecret());
}

export async function createPaymentCheckout(
  input: PaymentCheckoutRequest,
): Promise<PaymentCheckoutResponse> {
  const secret = getXenditSecret();
  if (!secret) {
    return {
      enabled: false,
      mode: 'unavailable',
      message:
        'Online payment is not configured yet. The reservation was saved; payment can be collected after hotel acceptance.',
    };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Payment amount must be a positive number.');
  }

  const externalId = `madyaw-${input.bookingId}-${Date.now()}`;
  const auth = Buffer.from(`${secret}:`).toString('base64');

  const response = await fetch('https://api.xendit.co/v2/invoices', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_id: externalId,
      amount: Math.round(input.amount),
      currency: input.currency ?? 'PHP',
      description: input.description,
      customer: {
        given_names: input.guestName,
        email: input.guestEmail,
      },
      success_redirect_url: input.successRedirectUrl,
      failure_redirect_url: input.failureRedirectUrl,
      metadata: {
        bookingId: input.bookingId,
        bookingReference: input.bookingReference ?? '',
      },
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Xendit invoice creation failed (${response.status}): ${bodyText.slice(0, 300)}`);
  }

  const invoice = (await response.json()) as { id?: string; invoice_url?: string };
  if (!invoice.invoice_url) {
    throw new Error('Xendit did not return an invoice URL.');
  }

  return {
    enabled: true,
    mode: 'live',
    checkoutUrl: invoice.invoice_url,
    externalId,
    message: 'Checkout session created.',
  };
}
