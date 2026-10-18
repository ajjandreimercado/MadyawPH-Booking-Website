import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Loader2, Upload } from 'lucide-react';
import { fetchHotelById } from '../../services/api';
import type { Hotel } from '../../types';
import {
  availableWalletMethods,
  hotelPaymentQrSrc,
  paymentQrProxyUrl,
  savePaymentQrImage,
  walletMethodLabel,
  walletPayFromGallerySteps,
  type WalletPaymentMethod,
} from '../../lib/paymentQr';
import { peso } from '../../lib/stayParams';

const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
  onError,
}: {
  hotelId: string;
  amount: number | null;
  file: File | null;
  onFile: (file: File | null) => void;
  reference: string;
  onReference: (value: string) => void;
  onError: (message: string) => void;
}) {
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [method, setMethod] = useState<WalletPaymentMethod | null>(null);
  const [qrAttempt, setQrAttempt] = useState(0);
  const [qrBroken, setQrBroken] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetchHotelById(hotelId)
      .then((h) => {
        if (!active) return;
        setHotel(h);
        setMethod(availableWalletMethods(h)[0] ?? null);
      })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [hotelId]);

  const methods = availableWalletMethods(hotel);
  // Always load the selected wallet's own QR — never reuse a single embedded image across tabs
  // (that made QR Ph show the PayMaya image).
  const qrSrc = method
    ? (qrAttempt === 0
      ? (hotelPaymentQrSrc(hotel, method) ?? paymentQrProxyUrl(hotelId, method))
      : paymentQrProxyUrl(hotelId, method, true))
    : '';

  const saveQr = async () => {
    if (!method) return;
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
      {methods.length > 1 && (
        <div role="tablist" aria-label="Payment app" className="flex gap-2">
          {methods.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={m === method}
              onClick={() => { setMethod(m); setQrAttempt(0); setQrBroken(false); }}
              className={`px-4 py-2 rounded-full border text-sm font-bold ${m === method ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-primary/25 text-brand-dark'}`}>
              {walletMethodLabel(m)}
            </button>
          ))}
        </div>
      )}

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
        </div>
        <div>
          <label htmlFor="booking-payment-ref" className="field-label">Reference number <span className="text-red-400">*</span></label>
          <input id="booking-payment-ref" type="text" autoComplete="off" value={reference}
            onChange={(e) => onReference(e.target.value.toUpperCase())}
            placeholder="From your GCash/Maya receipt" className="input-field uppercase" />
        </div>
      </div>
      <p className="text-[11px] font-bold text-brand-dark/50">
        The hotel checks your screenshot against its {walletMethodLabel(method)} account, then confirms your stay by email.
      </p>
    </div>
  );
}
