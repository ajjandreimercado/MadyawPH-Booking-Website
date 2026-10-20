import './testSetup';
import { BookingModel, ExternalReservationModel } from '../data/mongoModels';

/**
 * Guest checkout gives an email OR a mobile number. The Mongoose schemas must not
 * require either one alone, or phone-only/email-only bookings fail at save time
 * ("guestEmail: Path `guestEmail` is required").
 */
describe('guest checkout contact fields in schemas', () => {
  it('booking schema does not require guestEmail or guest_phone individually', () => {
    const email = BookingModel.schema.path('guestEmail') as unknown as { options: { required?: unknown } };
    const phone = BookingModel.schema.path('guest_phone') as unknown as { options: { required?: unknown } };
    expect(email.options.required).toBeFalsy();
    expect(phone.options.required).toBeFalsy();
  });

  it('external reservation (hotel FO queue) schema does not require either contact alone', () => {
    const email = ExternalReservationModel.schema.path('guest_email') as unknown as { options: { required?: unknown } };
    const phone = ExternalReservationModel.schema.path('guest_phone') as unknown as { options: { required?: unknown } };
    expect(email.options.required).toBeFalsy();
    expect(phone.options.required).toBeFalsy();
  });

  /** Fill every still-required path with a dummy value, then override contacts. */
  function fillRequired(model: typeof BookingModel, overrides: Record<string, unknown>) {
    const doc: Record<string, unknown> = {};
    model.schema.eachPath((path, type) => {
      const required = (type as unknown as { options: { required?: unknown } }).options.required;
      if (!required || path === '_id' || path === '__v') return;
      const instance = (type as unknown as { instance?: string }).instance;
      doc[path] = instance === 'Number' ? 1 : instance === 'Date' ? new Date() : 'x';
    });
    return new model({ ...doc, ...overrides });
  }

  it('a phone-only booking (no email) passes validation', async () => {
    const booking = fillRequired(BookingModel, { guestEmail: '', guest_email: '', guest_phone: '+63 912 345 6789' });
    await expect(booking.validate()).resolves.toBeUndefined();
  });

  it('an email-only booking (no phone) passes validation', async () => {
    const booking = fillRequired(BookingModel, { guestEmail: 'guest@example.com', guest_phone: '' });
    await expect(booking.validate()).resolves.toBeUndefined();
  });

  it('a phone-only external reservation passes validation', async () => {
    const reservation = fillRequired(ExternalReservationModel as never, {
      guest_email: '',
      guest_phone: '+63 912 345 6789',
    });
    await expect(reservation.validate()).resolves.toBeUndefined();
  });
});
