import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Loader2, Upload, X } from 'lucide-react';
import { fetchHotelById } from '../../services/api';
import type { BookingPaymentMethod, Hotel } from '../../types';
import {
  availableWalletMethods,
  hotelPaymentQrSrc,
  paymentQrProxyUrl,
  resolveMediaUrl,
  savePaymentQrImage,
  walletMethodLabel,
  walletPayFromGallerySteps,
  type WalletPaymentMethod,
} from '../../lib/paymentQr';
import { peso } from '../../lib/stayParams';

const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** How the guest pays this hotel directly: a wallet QR, QR Ph, or bank transfer. */
type PayMethod = WalletPaymentMethod | 'bank';

/**
 * Finish-booking payment: the hotel's own GCash/Maya/QR Ph QR, then the guest's receipt
 * screenshot and reference number. The screenshot goes to the hotel app with the booking,
 * and hotel staff verify it there.
 */
export default function PayByQr({
  hotelId,
  amount,
  file,
  onFile,
  reference,
  onReference,
  amountPaid,
  onAmountPaid,
  onError,
  onMethodChange,
}: {
  hotelId: string;
  amount: number | null;
  file: File | null;
  onFile: (file: File | null) => void;
  reference: string;
  onReference: (value: string) => void;
  /** Amount the guest typed from their receipt (₱). */
  amountPaid: string;
  onAmountPaid: (value: string) => void;
  onError: (message: string) => void;
  /** Reports the guest's chosen payment method so the booking records it. */
  onMethodChange?: (method: BookingPaymentMethod) => void;
}) {
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [qrAttempt, setQrAttempt] = useState(0);
  const [qrBroken, setQrBroken] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetchHotelById(hotelId)
      .then((h) => {
        if (!active) return;
        setHotel(h);
        const bankAvailable = Boolean(h.paymentAccounts?.bank || h.paymentQrs?.bank);
        setMethod(availableWalletMethods(h)[0] ?? (bankAvailable ? 'bank' : null));
      })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [hotelId]);

  useEffect(() => {
    if (method && onMethodChange) {
      onMethodChange(method === 'bank' ? 'bank-transfer' : method);
    }
  }, [method, onMethodChange]);

  // Preview of the guest's receipt screenshot (replaced/removed before submitting).
  const proofPreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (proofPreview) URL.revokeObjectURL(proofPreview); }, [proofPreview]);

  const methods = availableWalletMethods(hotel);
  const bankAvailable = Boolean(hotel?.paymentAccounts?.bank || hotel?.paymentQrs?.bank);
  const bankQrSrc = hotel?.paymentQrs?.bank ? resolveMediaUrl(hotel.paymentQrs.bank) : undefined;
  const isBank = method === 'bank';
  // Always load the selected wallet's own QR — never reuse a single embedded image across tabs
  // (that made QR Ph show the PayMaya image).
  const qrSrc = isBank
    ? (bankQrSrc ?? '')
    : method
      ? (qrAttempt === 0
        ? (hotelPaymentQrSrc(hotel, method) ?? paymentQrProxyUrl(hotelId, method))
        : paymentQrProxyUrl(hotelId, method, true))
      : '';

  const saveQr = async () => {
    if (!method || method === 'bank') return;
    setSaving(true);
    try {
      const result = await savePaymentQrImage(qrSrc, { method, hotelName: hotel?.name });
      if (result === 'failed') onError('Could not save the QR. Take a screenshot of it instead.');
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return <p className="text-sm font-bold text-brand-danger">We couldn't load the hotel's payment QR. Please refresh the page.</p>;
  }
  if (!hotel) {
    return <p className="flex items-center gap-2 text-sm font-bold text-brand-dark/60"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading the hotel's payment QR…</p>;
  }
  if (!method) {
    return (
      <p className="text-sm font-bold text-brand-danger">
        This hotel hasn't set up a payment QR yet{hotel.contactNumber ? ` — please call ${hotel.contactNumber}` : ''}.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {(methods.length > 1 || (methods.length >= 1 && bankAvailable)) && (
        <div role="tablist" aria-label="Payment method" className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={m === method}
              onClick={() => { setMethod(m); setQrAttempt(0); setQrBroken(false); }}
              className={`px-4 py-2 rounded-full border text-sm font-bold ${m === method ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-primary/25 text-brand-dark'}`}>
              {walletMethodLabel(m)}
            </button>
          ))}
          {bankAvailable && (
            <button type="button" role="tab" aria-selected={isBank}
              onClick={() => { setMethod('bank'); setQrAttempt(0); setQrBroken(false); }}
              className={`px-4 py-2 rounded-full border text-sm font-bold ${isBank ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-primary/25 text-brand-dark'}`}>
              Bank transfer
            </button>
          )}
        </div>
      )}

      {isBank ? (
        <div className="grid gap-5 sm:grid-cols-[220px_1fr] items-start">
          <div className="text-center">
            {bankQrSrc && !qrBroken ? (
              <img
                key={bankQrSrc}
                src={bankQrSrc}
                alt={`${hotel.name} bank transfer QR`}
                referrerPolicy="no-referrer"
                className="mx-auto w-52 h-52 object-contain rounded-xl bg-white p-2 border border-brand-primary/15"
                onError={() => setQrBroken(true)}
              />
            ) : (
              <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-xl border border-brand-primary/15 bg-white p-4 text-sm font-bold text-brand-dark/60">
                Use the bank details shown here
              </div>
            )}
          </div>
          <div className="text-sm">
            <p className="font-bold text-brand-dark">
              Transfer {amount != null ? peso(amount) : 'the total'} to {hotel.name}'s bank account
            </p>
            {hotel.paymentAccounts?.bank && (
              <p className="mt-2 whitespace-pre-line rounded-xl bg-brand-primary/5 border border-brand-primary/15 px-3 py-2 font-bold text-brand-dark">
                {hotel.paymentAccounts.bank}
              </p>
            )}
            <ol className="mt-2 list-decimal pl-5 space-y-1 text-brand-dark/70 font-bold">
              <li>Open your bank app and transfer exactly {amount != null ? peso(amount) : 'the amount shown'} to the account above.</li>
              <li>Complete the transfer first — do not upload a receipt before paying.</li>
              <li>Take a screenshot of the transfer receipt and upload it below with its reference number.</li>
            </ol>
          </div>
        </div>
      ) : method && (
        <div className="grid gap-5 sm:grid-cols-[220px_1fr] items-start">
          <div className="text-center">
            {qrBroken ? (
              <p className="text-sm font-bold text-brand-danger">The QR image didn't load.{hotel.contactNumber ? ` Call the hotel at ${hotel.contactNumber}.` : ''}</p>
            ) : (
              <img
                key={qrSrc}
                src={qrSrc}
                alt={`${hotel.name} ${walletMethodLabel(method)} payment QR`}
                referrerPolicy="no-referrer"
                className="mx-auto w-52 h-52 object-contain rounded-xl bg-white p-2 border border-brand-primary/15"
                onError={() => (qrAttempt === 0 ? setQrAttempt(1) : setQrBroken(true))}
              />
            )}
            <button type="button" onClick={() => void saveQr()} disabled={saving || qrBroken}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-brand-primary underline disabled:opacity-50">
              <Download className="w-3.5 h-3.5" aria-hidden /> {saving ? 'Saving…' : 'Save QR to pay from your gallery'}
            </button>
            {hotel.paymentAccounts?.[method] && (
              <p className="mt-2 text-xs font-bold text-brand-dark/60">
                {walletMethodLabel(method)} account: {hotel.paymentAccounts[method]}
              </p>
            )}
          </div>
          <div className="text-sm">
            <p className="font-bold text-brand-dark">
              Pay {amount != null ? peso(amount) : 'the total'} to {hotel.name} with {walletMethodLabel(method)}
            </p>
            <ol className="mt-2 list-decimal pl-5 space-y-1 text-brand-dark/70 font-bold">
              {walletPayFromGallerySteps(method, amount ?? undefined).map((step) => <li key={step}>{step}</li>)}
              <li>Take a screenshot of the receipt and upload it below.</li>
            </ol>
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-bold text-brand-dark">Please attach a screenshot of the payment receipt you just made.</p>
        <p className="mt-1 text-[11px] font-bold text-brand-dark/50">
          Uploading a receipt does not automatically verify your payment — {hotel.name} checks it before confirming your booking.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="booking-payment-proof" className="field-label">Payment screenshot <span className="text-red-400">*</span></label>
          <label htmlFor="booking-payment-proof"
            className={`flex items-center gap-2 w-full p-3 border-2 border-dashed rounded-xl cursor-pointer text-sm font-bold ${
              file ? 'border-brand-success bg-brand-success/5 text-brand-success' : 'border-brand-primary/25 text-brand-dark/60 hover:border-brand-primary/50'
            }`}>
            {file ? <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden /> : <Upload className="w-5 h-5 shrink-0 text-brand-primary/60" aria-hidden />}
            <span className="truncate">{file ? file.name : 'Upload your receipt (JPG, PNG or WEBP, max 5 MB)'}</span>
            <input
              id="booking-payment-proof"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (!picked) return;
                if (!PROOF_TYPES.includes(picked.type)) {
                  onError('The payment screenshot must be a JPG, PNG or WEBP image');
                  e.target.value = '';
                  return;
                }
                if (picked.size > 5 * 1024 * 1024) {
                  onError('The payment screenshot must be 5 MB or smaller');
                  e.target.value = '';
                  return;
                }
                onFile(picked);
              }}
            />
          </label>
          {file && proofPreview && (
            <div className="mt-2">
              <img src={proofPreview} alt="Your payment receipt" className="max-h-44 w-full rounded-xl border border-brand-primary/15 object-contain bg-white" />
              <div className="mt-1.5 flex items-center gap-3 text-xs font-bold">
                <span className="text-brand-dark/55">Tap the upload box above to replace this image.</span>
                <button type="button" onClick={() => onFile(null)}
                  className="inline-flex items-center gap-1 text-brand-danger underline">
                  <X className="w-3.5 h-3.5" aria-hidden /> Remove
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <label htmlFor="booking-payment-ref" className="field-label">Reference number <span className="text-red-400">*</span></label>
          <input id="booking-payment-ref" type="text" autoComplete="off" value={reference}
            onChange={(e) => onReference(e.target.value.toUpperCase())}
            placeholder="From your GCash/Maya receipt" className="input-field uppercase" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="booking-payment-amount" className="field-label">
            Amount paid (₱) <span className="text-red-400">*</span>
          </label>
          <input
            id="booking-payment-amount"
            type="number"
            inputMode="decimal"
            min={1}
            step="0.01"
            autoComplete="off"
            value={amountPaid}
            onChange={(e) => onAmountPaid(e.target.value)}
            placeholder={amount != null ? String(amount) : 'Amount on your receipt'}
            className="input-field"
          />
          <p className="mt-1 text-[11px] font-bold text-brand-dark/50">
            Pay exactly{amount != null ? ` ${peso(amount)}` : ' the amount shown above'} first, then enter the amount on your receipt.
            The hotel checks your receipt before it approves the booking.
          </p>
        </div>
      </div>
      <p className="text-[11px] font-bold text-brand-dark/50">
        The hotel checks your screenshot against its {isBank ? 'bank' : method ? walletMethodLabel(method) : ''} account, then confirms your stay by email.
      </p>
    </div>
  );
}
