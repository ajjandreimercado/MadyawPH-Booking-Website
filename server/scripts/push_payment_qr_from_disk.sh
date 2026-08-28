#!/bin/sh
# Run on MADYAWPH Render Shell after uploading a payment QR to persistent disk.
# Pushes image bytes into Mongo (system_settings.payment_qr_blob) so the booking
# website can display the QR even before a public /uploads URL exists.
#
# Usage (Render Shell on MADYAWPH):
#   export HOTEL_ID=6a34ab5d79d95cdfca01b82c
#   export MADYAW_API_URL=https://madyaw-api.onrender.com/api
#   export HOTEL_WEBHOOK_SECRET=your-shared-secret
#   sh /app/scripts/push_payment_qr_from_disk.sh /var/data/uploads/payment-qr/YOURFILE.jpg

set -eu

FILE="${1:-}"
HOTEL_ID="${HOTEL_ID:-}"
API="${MADYAW_API_URL:-https://madyaw-api.onrender.com/api}"
SECRET="${HOTEL_WEBHOOK_SECRET:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: HOTEL_ID=... HOTEL_WEBHOOK_SECRET=... $0 /var/data/uploads/payment-qr/file.jpg"
  exit 1
fi
if [ -z "$HOTEL_ID" ] || [ -z "$SECRET" ]; then
  echo "Set HOTEL_ID and HOTEL_WEBHOOK_SECRET"
  exit 1
fi

BASENAME=$(basename "$FILE")
REL="payment-qr/$BASENAME"
B64=$(base64 -w 0 "$FILE" 2>/dev/null || base64 "$FILE" | tr -d '\n')

curl -sfS -X POST "$API/hotels/payment-qr-cache" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"hotelId\":\"$HOTEL_ID\",\"payment_qr_url\":\"$REL\",\"base64\":\"$B64\",\"mime\":\"image/jpeg\"}"

echo ""
echo "Pushed $REL for hotel $HOTEL_ID"
