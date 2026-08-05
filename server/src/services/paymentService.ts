/**
 * Payment checkout provider abstraction.
 *
 * Production-safe defaults:
 * - If XENDIT_SECRET_KEY is not configured, checkout stays unavailable and
 *   bookings continue to work as reservation requests (no fake paid state).
 * - When the key is present, this creates an Xendit Invoice and returns a URL.
 * - The secret key never leaves the server process (not in responses or logs).
 */

import { getXenditSecretKey } from '../config/env';

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

export function isOnlinePaymentEnabled() {
  return Boolean(getXenditSecretKey());
}

export async function createPaymentCheckout(
  input: PaymentCheckoutRequest,
): Promise<PaymentCheckoutResponse> {
  const secret = getXenditSecretKey();
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

  let response: Response;
  try {
    response = await fetch('https://api.xendit.co/v2/invoices', {
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
  } catch (error) {
    console.error('[Payment] Xendit request failed:', error instanceof Error ? error.message : error);
    throw new Error('Unable to reach the payment provider. Please try again later.');
  }

  if (!response.ok) {
    const bodyText = await response.text();
    // Log provider detail server-side only — never echo raw provider bodies to browsers.
    console.error(`[Payment] Xendit invoice error (${response.status}): ${bodyText.slice(0, 500)}`);
    throw new Error('Unable to create payment checkout. Please try again later.');
  }

  const invoice = (await response.json()) as { id?: string; invoice_url?: string };
  if (!invoice.invoice_url) {
    console.error('[Payment] Xendit response missing invoice_url');
    throw new Error('Unable to create payment checkout. Please try again later.');
  }

  return {
    enabled: true,
    mode: 'live',
    checkoutUrl: invoice.invoice_url,
    externalId,
    message: 'Checkout session created.',
  };
}
