import './testSetup';
import {
  buildHotelWelcomeBody,
  buildRebookUrl,
  formatRoomStayLabel,
  formatStayDate,
  formatStayLength,
  senderFor,
  buildHotelWelcomeHtml,
  buildVerifyReservationUrl,
  resolveRoomStayDetails,
} from '../services/notificationService';
import { ExternalReservationModel, PropertyModel } from '../data/mongoModels';

describe('buildRebookUrl', () => {
  it('prefers the hotel detail page when hotel_id is present', () => {
    const url = buildRebookUrl({
      hotel_id: 'hotel-123',
      propertyId: 'room-9',
    });
    expect(url).toBe('http://localhost:3000/hotels/hotel-123');
  });

  it('falls back to booking page with dates when only propertyId exists', () => {
    const url = buildRebookUrl({
      propertyId: 'room-9',
      checkInDate: '2026-08-10',
      checkOutDate: '2026-08-12',
    });
    expect(url).toContain('/booking/room-9');
    expect(url).toContain('checkIn=2026-08-10');
    expect(url).toContain('checkOut=2026-08-12');
  });
});

describe('email formatting', () => {
  it('formats stay dates as month-day-year', () => {
    expect(formatStayDate('2026-10-18', 'x')).toBe('Oct 18, 2026');
    expect(formatStayDate(undefined, 'your check-in date')).toBe('your check-in date');
  });

  it('describes the stay length in nights', () => {
    expect(formatStayLength({ nights: 1 })).toBe('1 night');
    expect(formatStayLength({ checkInDate: '2026-10-18', checkOutDate: '2026-10-21' })).toBe('3 nights');
    expect(formatStayLength({})).toBe('');
  });

  it('sends in the hotel name from the configured address', () => {
    process.env.EMAIL_FROM = 'Madyaw Bookings <noreply@madyaw.com>';
    expect(senderFor('Gloreto Luxury Hotel')).toBe('Gloreto Luxury Hotel <noreply@madyaw.com>');
    expect(senderFor('Bad "<x>"\r\nName')).toBe('Bad xName <noreply@madyaw.com>');
  });

  it('labels rooms as category · room number', () => {
    expect(formatRoomStayLabel({
      category_name: 'Family Room',
      room_number: '210',
      display_name: 'Room 210',
    })).toBe('Family Room · 210');
  });

  it('builds a welcome email with hotel name, room, and access password', () => {
    const body = buildHotelWelcomeBody({
      guestFirstName: 'Alex',
      hotelName: 'Gloreto Luxury Hotel',
      roomLabel: 'Family Room · 210',
      accessPassword: 'SJSW',
      bookingReference: 'BR-123',
      checkIn: 'Oct 19, 2026',
      checkOut: 'Oct 20, 2026',
      stayLength: '1 night',
      stayTotal: 2500,
    });
    expect(body).toContain('Welcome to Gloreto Luxury Hotel!');
    expect(body).toContain('YOUR ROOM');
    expect(body).toContain('Family Room · 210');
    expect(body).toContain('ROOM ACCESS PASSWORD');
    expect(body).toContain('SJSW');
    expect(body).not.toContain('reserved');
  });
});

describe('approval welcome email', () => {
  it('shows the room number and access password in the hotel name, escaping text', () => {
    const html = buildHotelWelcomeHtml({
      hotelName: 'Gloreto <Hotel>',
      guestName: 'AJ',
      roomNumber: '1',
      roomLabel: 'Single Bed',
      accessPassword: 'W4YX',
      bookingReference: 'BR-1',
      checkIn: 'Oct 19, 2026',
      checkOut: 'Oct 20, 2026',
    });
    expect(html).toContain('Welcome to Gloreto &lt;Hotel&gt;!');
    expect(html).toContain('Room 1');
    expect(html).toContain('W4YX');
    expect(html).not.toContain('Madyaw');
  });

  it('includes a reservation verification QR block when a verify URL is given', () => {
    const html = buildHotelWelcomeHtml({
      hotelName: 'Gloreto', guestName: 'AJ', roomNumber: '1', roomLabel: '', accessPassword: '',
      bookingReference: 'BR-1', checkIn: 'a', checkOut: 'b',
      verifyUrl: 'https://madyaw.com/booking/confirm/b1?token=abc',
    });
    expect(html).toContain('VERIFY YOUR RESERVATION');
    expect(html).toContain('cid:booking-qr');
    expect(html).toContain('https://madyaw.com/booking/confirm/b1?token=abc');

    const url = buildVerifyReservationUrl({ _id: 'b1', guestEmail: 'aj@example.com' });
    expect(url).toContain('/booking/confirm/b1');
    expect(url).toContain('token=');
  });

  it('says the password comes at check-in when there is none for this guest', () => {
    const html = buildHotelWelcomeHtml({
      hotelName: 'Gloreto', guestName: 'AJ', roomNumber: '1', roomLabel: '', accessPassword: '',
      bookingReference: 'BR-1', checkIn: 'a', checkOut: 'b',
    });
    expect(html).toMatch(/given to you at check-in/);
    expect(html).not.toContain('ROOM ACCESS PASSWORD');
  });

  it("never uses the door code of another guest currently in the room", async () => {
    const room = { room_number: '1', category_name: 'Single', current_access_code: 'W4YX', current_guest_name: 'Someone Else', current_check_in: new Date('2026-10-19T06:00:00Z') };
    const spy = jest.spyOn(PropertyModel, 'findById').mockReturnValue({ select: () => ({ lean: async () => room }) } as never);
    const noReservation = jest.spyOn(ExternalReservationModel, 'findOne').mockReturnValue({ select: () => ({ lean: async () => null }) } as never);
    const other = await resolveRoomStayDetails({ room_id: 'r1', guestName: 'AJ Jandrei', checkInDate: '2026-10-19' });
    expect(other.accessPassword).toBe('');
    expect(other.roomNumber).toBe('1');
    const mine = await resolveRoomStayDetails({ room_id: 'r1', guestName: 'someone else', checkInDate: '2026-10-19' });
    expect(mine.accessPassword).toBe('W4YX');
    spy.mockRestore();
    noReservation.mockRestore();
  });

  it('uses the door code MADYAWPH saved on the approved reservation', async () => {
    const room = { room_number: '1', category_name: 'Single', current_access_code: 'W4YX', current_guest_name: 'Someone Else' };
    const spy = jest.spyOn(PropertyModel, 'findById').mockReturnValue({ select: () => ({ lean: async () => room }) } as never);
    const reservation = jest.spyOn(ExternalReservationModel, 'findOne')
      .mockReturnValue({ select: () => ({ lean: async () => ({ metadata: JSON.stringify({ guest_access_code: 'K7PQ' }) }) }) } as never);
    const details = await resolveRoomStayDetails({ _id: 'b1', room_id: 'r1', guestName: 'AJ Jandrei', checkInDate: '2026-10-25' });
    expect(details.accessPassword).toBe('K7PQ');
    spy.mockRestore();
    reservation.mockRestore();
  });
});
