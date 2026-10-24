import { jsPDF } from "jspdf";
import type { BookingRequest } from "../types";
import { formatStayDate } from "./stayParams";

// ─── Brand colours (match the site's navy blue) ────────────────────────────
const BRAND_PRIMARY = "#1D4E89";
const BRAND_DARK = "#0A192F";
const BRAND_SOFT = "#F3F7FB";
const BRAND_LINE = "#C9D8E8";
const MUTED: [number, number, number] = [96, 115, 138];

function hexRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

/** Everything printed on a receipt. Dates are yyyy-MM-dd, times HH:mm (24 h). */
export interface ReceiptData {
  /** Booking number(s), e.g. AA-AB-O-261023-1532 (one per room type). */
  references: string[];
  status: string;
  bookedAt: Date;
  hotelName: string;
  hotelLocation?: string;
  roomName: string;
  checkIn: string;
  checkInTime: string;
  checkOut: string;
  checkOutTime: string;
  stayLength: string;
  guests: string;
  rooms?: string;
  guestName: string;
  stayGuestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  specialRequests?: string;
  stayPrice: number;
  discountLabel?: string;
  discountAmount?: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentMethod: string;
}

const php = (n: number) => `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = { gcash: "GCash", maya: "Maya", qrph: "QR Ph", "bank-transfer": "Bank transfer" };
  return labels[method] ?? method.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const logoUrl = new URL("../../madyaw logo.jpg", import.meta.url).href;
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function buildReceipt(data: ReceiptData): Promise<jsPDF> {
  const logoDataUrl = await loadLogoDataUrl();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const MARGIN = 18;
  const CONTENT_W = PW - MARGIN * 2;
  let y = 0;

  const setFill = (hex: string) => { const [r, g, b] = hexRgb(hex); doc.setFillColor(r, g, b); };
  const setTC = (hex: string) => { const [r, g, b] = hexRgb(hex); doc.setTextColor(r, g, b); };
  const setDC = (hex: string) => { const [r, g, b] = hexRgb(hex); doc.setDrawColor(r, g, b); };
  const t = (s: string, x: number, yy: number, o?: Parameters<typeof doc.text>[3]) => doc.text(s, x, yy, o);
  const ensure = (height: number) => { if (y + height > PH - 16) { doc.addPage(); y = 18; } };

  // ── Header band ──────────────────────────────────────────────────────────
  const HEADER_H = 34;
  setFill(BRAND_PRIMARY);
  doc.rect(0, 0, PW, HEADER_H, "F");
  if (logoDataUrl) doc.addImage(logoDataUrl, "JPEG", MARGIN, 6, 22, 22);
  const textX = logoDataUrl ? MARGIN + 27 : MARGIN;
  setTC("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  t("MADYAW", textX, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(214, 228, 244);
  t("Book rooms directly with partner hotels", textX, 25);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  setTC("#ffffff");
  t("BOOKING RECEIPT", PW - MARGIN, 15, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(214, 228, 244);
  const issued = data.bookedAt.toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" });
  t(`Booked: ${issued}`, PW - MARGIN, 22, { align: "right" });
  y = HEADER_H + 6;

  // ── Booking number ────────────────────────────────────────────────────────
  const refLines = data.references.length > 0 ? data.references : ["—"];
  const refBoxH = 14 + refLines.length * 8;
  setFill(BRAND_SOFT);
  doc.roundedRect(MARGIN, y, CONTENT_W, refBoxH, 3, 3, "F");
  setDC(BRAND_LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, y, CONTENT_W, refBoxH, 3, 3, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  t(refLines.length > 1 ? "BOOKING NUMBERS" : "BOOKING NUMBER", PW / 2, y + 7, { align: "center" });
  doc.setFontSize(18);
  setTC(BRAND_PRIMARY);
  refLines.forEach((ref, i) => t(ref, PW / 2, y + 15 + i * 8, { align: "center" }));
  y += refBoxH + 4;

  // ── Status ────────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const statusText = data.status.toUpperCase();
  const bw = doc.getTextWidth(statusText) + 14;
  setFill("#E6EEF8");
  doc.roundedRect(PW / 2 - bw / 2, y, bw, 8, 2, 2, "F");
  setTC(BRAND_PRIMARY);
  t(statusText, PW / 2, y + 5.5, { align: "center" });
  y += 12;

  // ── Section & row helpers ─────────────────────────────────────────────────
  const section = (title: string) => {
    ensure(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    setTC(BRAND_PRIMARY);
    const label = title.toUpperCase();
    t(label, MARGIN, y);
    setDC(BRAND_PRIMARY);
    doc.setLineWidth(0.35);
    doc.line(MARGIN + doc.getTextWidth(label) + 2, y - 0.5, MARGIN + CONTENT_W, y - 0.5);
    y += 6.5;
  };
  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(value || "—", CONTENT_W - 48) as string[];
    ensure(lines.length * 4.4 + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    t(label, MARGIN, y);
    doc.setFont("helvetica", "bold");
    setTC(BRAND_DARK);
    doc.text(lines, MARGIN + CONTENT_W, y, { align: "right" });
    y += lines.length * 4.2 + 1;
    setDC(BRAND_LINE);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y - 0.6, MARGIN + CONTENT_W, y - 0.6);
    y += 1.4;
  };

  // ── Stay details ──────────────────────────────────────────────────────────
  section("Stay Details");
  row("Hotel", data.hotelName);
  if (data.hotelLocation) row("Address", data.hotelLocation);
  row("Room type", data.roomName);
  if (data.rooms) row("Rooms", data.rooms);
  row("Check-in", `${formatStayDate(data.checkIn)}, from ${clock(data.checkInTime)}`);
  row("Check-out", `${formatStayDate(data.checkOut)}, until ${clock(data.checkOutTime)}`);
  row("Length of stay", data.stayLength);
  row("Guests", data.guests);
  y += 2;

  // ── Guest information ─────────────────────────────────────────────────────
  section("Guest Information");
  row("Booked by", data.guestName);
  if (data.stayGuestName) row("Guest staying", data.stayGuestName);
  if (data.guestPhone) row("Mobile", data.guestPhone);
  if (data.guestEmail) row("Email", data.guestEmail);
  if (data.specialRequests) row("Special requests", data.specialRequests);
  y += 2;

  // ── Payment ───────────────────────────────────────────────────────────────
  section("Payment");
  row("Payment method", data.paymentMethod);
  row("Stay price", php(data.stayPrice));
  if ((data.discountAmount ?? 0) > 0) row(data.discountLabel || "Discount", `-${php(data.discountAmount ?? 0)}`);
  row("Taxes and charges", "Included");
  if (data.balanceDue > 0) row("Balance to pay at the hotel", php(data.balanceDue));
  y += 2;

  ensure(34);
  const boxH = 13;
  setFill(BRAND_PRIMARY);
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2.5, 2.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  setTC("#ffffff");
  t("TOTAL", MARGIN + 8, y + 8.5);
  doc.setFontSize(12);
  t(php(data.total), MARGIN + CONTENT_W - 8, y + 8.5, { align: "right" });
  y += boxH + 3;
  setFill("#E6EEF8");
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2.5, 2.5, "F");
  doc.setFontSize(9.5);
  setTC(BRAND_PRIMARY);
  t("AMOUNT PAID (awaiting front desk check)", MARGIN + 8, y + 8.5);
  doc.setFontSize(12);
  t(php(data.amountPaid), MARGIN + CONTENT_W - 8, y + 8.5, { align: "right" });
  y += boxH + 7;

  // ── Notes & footer ────────────────────────────────────────────────────────
  ensure(30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  const notes = [
    "The hotel's front desk checks your payment screenshot and notifies you when your booking is confirmed.",
    "Bookings are non-refundable. If the hotel declines your booking, your payment is refunded in full.",
    "Show your booking number at check-in, with a valid government ID.",
  ];
  notes.forEach((note) => {
    const lines = doc.splitTextToSize(`•  ${note}`, CONTENT_W) as string[];
    doc.text(lines, MARGIN, y);
    y += lines.length * 4 + 1;
  });
  y += 3;
  setDC(BRAND_LINE);
  doc.setLineWidth(0.25);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 5;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  t("Thank you for booking with Madyaw.  madyaw.com", PW / 2, y, { align: "center" });
  return doc;
}

function receiptFileName(data: ReceiptData): string {
  const ref = (data.references[0] ?? "booking").replace(/[^A-Za-z0-9-]/g, "");
  return `madyaw-receipt-${ref.toLowerCase()}.pdf`;
}

export async function downloadReceipt(data: ReceiptData): Promise<void> {
  (await buildReceipt(data)).save(receiptFileName(data));
}

/** Opens the print dialog for the receipt; falls back to opening the PDF if printing is blocked. */
export async function printReceipt(data: ReceiptData): Promise<void> {
  const doc = await buildReceipt(data);
  const url = URL.createObjectURL(doc.output("blob"));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, "_blank");
    }
    // Keep the iframe long enough for the print dialog to read the PDF.
    window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000);
  };
  document.body.appendChild(frame);
}

/** Receipt for an existing booking (confirmation page). */
export function receiptFromBooking(booking: BookingRequest): ReceiptData {
  const extra = booking as unknown as Record<string, unknown>;
  const nights = booking.nights ?? 1;
  const total = booking.totalPrice ?? 0;
  const paid = booking.amountPaid ?? 0;
  const guests = [
    `${booking.adults ?? 1} adult${(booking.adults ?? 1) !== 1 ? "s" : ""}`,
    (booking.children ?? 0) > 0 ? `${booking.children} child${booking.children !== 1 ? "ren" : ""}` : null,
  ].filter(Boolean).join(", ");
  const confirmed = booking.status === "confirmed" || booking.status === "paid" || booking.status === "reserved" || booking.status === "booked";
  return {
    references: [String(booking.bookingReference ?? booking.id)],
    status: confirmed ? "Confirmed by the hotel" : booking.status === "declined" ? "Declined by the hotel" : "Pending hotel confirmation",
    bookedAt: new Date(booking.requestedAt ?? Date.now()),
    hotelName: String(extra.hotelName ?? booking.propertyName ?? ""),
    hotelLocation: extra.hotelLocation ? String(extra.hotelLocation) : undefined,
    roomName: booking.propertyName ?? "",
    checkIn: booking.checkInDate,
    checkInTime: booking.checkInTime ?? "14:00",
    checkOut: booking.checkOutDate,
    checkOutTime: booking.checkOutTime ?? "11:00",
    stayLength: `${nights} night${nights !== 1 ? "s" : ""}`,
    guests,
    guestName: booking.guestName,
    guestPhone: booking.guestPhone,
    guestEmail: booking.guestEmail || undefined,
    specialRequests: extra.specialRequests ? String(extra.specialRequests) : undefined,
    stayPrice: (booking.roomRate ?? 0) * nights || total + (booking.discountAmount ?? 0),
    discountAmount: booking.discountAmount,
    total,
    amountPaid: paid || total,
    balanceDue: booking.balanceDue ?? Math.max(0, total - (paid || total)),
    paymentMethod: paymentMethodLabel(booking.paymentMethod ?? ""),
  };
}

export async function downloadReceiptPdf(booking: BookingRequest): Promise<void> {
  await downloadReceipt(receiptFromBooking(booking));
}
