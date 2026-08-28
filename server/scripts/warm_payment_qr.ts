/**
 * Fetch payment QR images from the hotel app and cache bytes in system_settings.
 * Usage: npx tsx scripts/warm_payment_qr.ts [hotelId]
 */
import { connectDatabase } from '../src/config/db';
import { warmAllPaymentQrCaches, fetchHotelPaymentQrImage, loadHotelSystemSettings } from '../src/utils/paymentQr';

async function main() {
  await connectDatabase();
  const hotelId = process.argv[2];
  if (hotelId) {
    const settings = await loadHotelSystemSettings(hotelId);
    const path = String(settings?.payment_qr_url ?? '');
    if (!path) {
      console.log('No payment_qr_url for', hotelId);
      process.exit(1);
    }
    const image = await fetchHotelPaymentQrImage(path, hotelId, { skipCache: true });
    console.log({ hotelId, path, ok: Boolean(image), bytes: image?.body.length });
    process.exit(image ? 0 : 1);
  }

  const results = await warmAllPaymentQrCaches();
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.every((row) => row.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
