import { jsPDF } from "jspdf";
import type { BookingRequest } from "../types";

// ─── Brand colours ─────────────────────────────────────────────────────────
const BRAND_PRIMARY   = "#5a7a6b";
const BRAND_DARK      = "#1a2e24";
const BRAND_CREAM     = "#f5f0e8";
const BRAND_LIGHT_LINE = "#d4c9b4";

function hexRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
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

export async function downloadReceiptPdf(booking: BookingRequest): Promise<void> {
  const logoDataUrl = await loadLogoDataUrl();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const MARGIN = 18;
  const CONTENT_W = PW - MARGIN * 2;
  let y = 0;

  const setFill = (hex: string) => { const [r, g, b] = hexRgb(hex); doc.setFillColor(r, g, b); };
  const setTC   = (hex: string) => { const [r, g, b] = hexRgb(hex); doc.setTextColor(r, g, b); };
  const setDC   = (hex: string) => { const [r, g, b] = hexRgb(hex); doc.setDrawColor(r, g, b); };
  const t = (s: string, x: number, yy: number, o?: Parameters<typeof doc.text>[3]) => doc.text(s, x, yy, o);

  // ── Header band ──────────────────────────────────────────────────────────
  const HEADER_H = 44;
  setFill(BRAND_PRIMARY);
  doc.rect(0, 0, PW, HEADER_H, "F");

  if (logoDataUrl) doc.addImage(logoDataUrl, "JPEG", MARGIN, 8, 24, 24);
  const textX = logoDataUrl ? MARGIN + 28 : MARGIN;

  setTC("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  t("MADYAW", textX, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(210, 228, 222);
  t("Premium Island Retreats & Experiences", textX, 30);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setTC("#ffffff");
  t("OFFICIAL RECEIPT", PW - MARGIN, 17, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(210, 228, 222);
  const issuedDate = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  t(`Issued: ${issuedDate}`, PW - MARGIN, 25, { align: "right" });

  y = HEADER_H + 8;

  // ── Booking reference card ───────────────────────────────────────────────
  setFill(BRAND_CREAM);
  doc.roundedRect(MARGIN, y, CONTENT_W, 27, 3, 3, "F");
  setDC(BRAND_LIGHT_LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, y, CONTENT_W, 27, 3, 3, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(122, 143, 135);
  t("BOOKING REFERENCE", PW / 2, y + 8, { align: "center" });

  const ref = ((booking as unknown as Record<string,unknown>).bookingReference as string | undefined)
    ?? booking.id.slice(0, 12).toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setTC(BRAND_PRIMARY);
  t(ref, PW / 2, y + 18, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(160, 168, 164);
  t(`Booking ID: ${booking.id}`, PW / 2, y + 24, { align: "center" });

  y += 33;

  // ── Status badge ─────────────────────────────────────────────────────────
  const statusLabel = (booking.status ?? "N/A").toUpperCase();
  const statusHex = booking.status === "confirmed" || booking.status === "paid" ? "#2a7a4a"
    : booking.status === "declined" ? "#c0392b" : BRAND_PRIMARY;
  const [sr, sg, sb] = hexRgb(statusHex);
  doc.setFillColor(
    sr + Math.round((255 - sr) * 0.82),
    sg + Math.round((255 - sg) * 0.82),
    sb + Math.round((255 - sb) * 0.82),
  );
  const bw = doc.getTextWidth(statusLabel) + 12;
  doc.roundedRect(PW / 2 - bw / 2, y, bw, 7.5, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(sr, sg, sb);
  t(statusLabel, PW / 2, y + 5.2, { align: "center" });

  y += 14;

  // ── Section & row helpers ─────────────────────────────────────────────────
  const section = (title: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    setTC(BRAND_PRIMARY);
    t(title.toUpperCase(), MARGIN, y);
    setDC(BRAND_PRIMARY);
    doc.setLineWidth(0.35);
    doc.line(MARGIN + doc.getTextWidth(title.toUpperCase()) + 2, y - 0.5, MARGIN + CONTENT_W, y - 0.5);
    y += 6.5;
  };

  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(122, 143, 135);
    t(label, MARGIN, y);
    doc.setFont("helvetica", "bold");
    setTC(BRAND_DARK);
    t(value || "—", MARGIN + CONTENT_W, y, { align: "right" });
    y += 6;
  };

  const divider = () => {
    setDC(BRAND_LIGHT_LINE);
    doc.setLineWidth(0.18);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 3.5;
  };

  // ── Reservation details ───────────────────────────────────────────────────
  section("Reservation Details");
  row("Property", booking.propertyName ?? "—");
  divider();
  row("Room Type", (booking.roomType ?? "—").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  divider();
  row("Check-in",  booking.checkInDate  ?? "—");
  divider();
  row("Check-out", booking.checkOutDate ?? "—");
  divider();
  row("Duration",  `${booking.nights ?? 0} night${(booking.nights ?? 0) !== 1 ? "s" : ""}`);
  divider();
  const guests = [
    `${booking.adults ?? 0} adult${(booking.adults ?? 0) !== 1 ? "s" : ""}`,
    (booking.children ?? 0) > 0 ? `${booking.children} child${(booking.children ?? 0) !== 1 ? "ren" : ""}` : null,
    (booking.infants  ?? 0) > 0 ? `${booking.infants} infant${(booking.infants ?? 0) !== 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(", ");
  row("Guests", guests);
  y += 5;

  // ── Guest information ─────────────────────────────────────────────────────
  section("Guest Information");
  row("Name",   booking.guestName  ?? "—");
  divider();
  row("Email",  booking.guestEmail ?? "—");
  divider();
  row("Mobile", (booking as unknown as Record<string,unknown>).guestPhone as string ?? "—");

  const special = (booking as unknown as Record<string,unknown>).specialRequests as string | undefined;
  if (special) {
    divider();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(122, 143, 135);
    t("Special Requests", MARGIN, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTC(BRAND_DARK);
    const lines = doc.splitTextToSize(special, CONTENT_W) as string[];
    doc.text(lines, MARGIN, y);
    y += lines.length * 5;
  }
  y += 5;

  // ── Payment summary ───────────────────────────────────────────────────────
  section("Payment Summary");
  row("Room Rate",       `PHP ${(booking.roomRate ?? 0).toLocaleString()} x ${(booking.nights ?? 1)} night(s)`);
  divider();
  row("Room Subtotal",   `PHP ${((booking.roomRate ?? 0) * (booking.nights ?? 1)).toLocaleString()}`);
  if ((booking.discountAmount ?? 0) > 0) {
    divider();
    row("Discount",      `-PHP ${(booking.discountAmount ?? 0).toLocaleString()}`);
  }
  divider();
  row("Payment Method", (booking.paymentMethod ?? "—").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  const amountPaid = booking.amountPaid ?? Math.floor((booking.totalPrice ?? 0) / 2);
  const balance = booking.balanceDue ?? Math.max(0, (booking.totalPrice ?? 0) - amountPaid);
  const isFullPayment = (booking.onlinePaymentMode ?? (booking.depositPercent === 100 ? 'full' : 'half')) === 'full'
    || (balance <= 0 && amountPaid >= (booking.totalPrice ?? 0) && (booking.totalPrice ?? 0) > 0);
  divider();
  row(isFullPayment ? "Full Payment (100%)" : "Partial Payment (50%)", `PHP ${amountPaid.toLocaleString()}`);
  if (!isFullPayment) {
    divider();
    row("Balance at Check-out", `PHP ${balance.toLocaleString()}`);
  }
  y += 3;

  // Total row (Box formatted cleanly without clipping)
  const totalBoxH = 14;
  setFill(BRAND_PRIMARY);
  doc.roundedRect(MARGIN, y, CONTENT_W, totalBoxH, 2.5, 2.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  setTC("#ffffff");
  t("STAY TOTAL", MARGIN + 8, y + 9);
  doc.setFontSize(12);
  t(`PHP ${(booking.totalPrice ?? 0).toLocaleString()}`, MARGIN + CONTENT_W - 8, y + 9, { align: "right" });

  y += totalBoxH + 4;
  setFill("#e8f5e9");
  doc.roundedRect(MARGIN, y, CONTENT_W, totalBoxH, 2.5, 2.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  setTC(BRAND_PRIMARY);
  t(isFullPayment ? "FULL PAYMENT RECORDED" : "PARTIAL (50%) RECORDED", MARGIN + 8, y + 9);
  doc.setFontSize(12);
  t(`PHP ${amountPaid.toLocaleString()}`, MARGIN + CONTENT_W - 8, y + 9, { align: "right" });

  y += totalBoxH + 10;

  // ── Footer ────────────────────────────────────────────────────────────────
  setDC(BRAND_LIGHT_LINE);
  doc.setLineWidth(0.25);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 5;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(154, 170, 159);
  t("Thank you for choosing Madyaw. We look forward to welcoming you.", PW / 2, y, { align: "center" });
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  t("madyaw.com  •  support@madyaw.com", PW / 2, y, { align: "center" });

  // ── Save ──────────────────────────────────────────────────────────────────
  const safeName = (booking.propertyName ?? "booking").replace(/[^a-z0-9]/gi, "-").toLowerCase();
  doc.save(`madyaw-receipt-${safeName}-${ref.slice(0, 10).toLowerCase()}.pdf`);
}
