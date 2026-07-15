import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/db';
import {
  HotelModel,
  RoomCategoryModel,
  PropertyModel,
  UserModel,
  BookingModel,
  ReviewModel,
  ExternalReservationModel,
  BillingChargeModel,
  RoomTransferModel,
  CheckoutReminderModel,
  StayReviewModel,
  StaffMemberModel,
  TaskModel,
  ActivityLogModel,
  AmenityMenuItemModel,
  AmenityClaimModel,
  GuestMessageModel,
  SystemSettingModel,
  UserSettingModel,
  HotelCreditModel,
  PersonalAccessTokenModel,
} from '../src/data/mongoModels';

interface LocalData {
  hotels?: unknown[];
  roomCategories?: unknown[];
  properties?: unknown[];
  users?: unknown[];
  bookings?: unknown[];
  reviews?: unknown[];
}

async function loadLocalData(): Promise<LocalData> {
  const filePath = path.resolve(__dirname, '../data/localDatabase.json');
  const contents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(contents) as LocalData;
}

async function clearCollections() {
  await Promise.all([
    HotelModel.deleteMany({}),
    RoomCategoryModel.deleteMany({}),
    PropertyModel.deleteMany({}),
    UserModel.deleteMany({}),
    BookingModel.deleteMany({}),
    ReviewModel.deleteMany({}),
    ExternalReservationModel.deleteMany({}),
    BillingChargeModel.deleteMany({}),
    RoomTransferModel.deleteMany({}),
    CheckoutReminderModel.deleteMany({}),
    StayReviewModel.deleteMany({}),
    StaffMemberModel.deleteMany({}),
    TaskModel.deleteMany({}),
    ActivityLogModel.deleteMany({}),
    AmenityMenuItemModel.deleteMany({}),
    AmenityClaimModel.deleteMany({}),
    GuestMessageModel.deleteMany({}),
    SystemSettingModel.deleteMany({}),
    UserSettingModel.deleteMany({}),
    HotelCreditModel.deleteMany({}),
    PersonalAccessTokenModel.deleteMany({}),
  ]);
}

async function migrate() {
  await connectDatabase();

  try {
    await clearCollections();

    const data = await loadLocalData();

    const collections = [
      { name: 'hotels', model: HotelModel, records: data.hotels ?? [] },
      { name: 'room_categories', model: RoomCategoryModel, records: data.roomCategories ?? [] },
      { name: 'rooms', model: PropertyModel, records: data.properties ?? [] },
      { name: 'users', model: UserModel, records: data.users ?? [] },
      {
  name: 'bookings',
  model: BookingModel,
  records: (data.bookings ?? []).map((booking: any) => ({
    ...booking,

    amountPaid:
      booking.amountPaid ??
      booking.total_amount ??
      booking.totalPrice ??
      0,

    payment_status:
      booking.payment_status ??
      booking.paymentStatus ??
      'pending',

    check_in_time:
      booking.check_in_time ??
      booking.checkInTime ??
      '14:00',

    check_out_time:
      booking.check_out_time ??
      booking.checkOutTime ??
      '12:00',
  })),
},
      { name: 'reviews', model: ReviewModel, records: data.reviews ?? [] },
      { name: 'external_reservations', model: ExternalReservationModel, records: [] },
      { name: 'billing_charges', model: BillingChargeModel, records: [] },
      { name: 'room_transfers', model: RoomTransferModel, records: [] },
      { name: 'checkout_reminders', model: CheckoutReminderModel, records: [] },
      { name: 'stay_reviews', model: StayReviewModel, records: [] },
      { name: 'staff_members', model: StaffMemberModel, records: [] },
      { name: 'tasks', model: TaskModel, records: [] },
      { name: 'activity_logs', model: ActivityLogModel, records: [] },
      { name: 'amenity_menu_items', model: AmenityMenuItemModel, records: [] },
      { name: 'amenity_claims', model: AmenityClaimModel, records: [] },
      { name: 'guest_messages', model: GuestMessageModel, records: [] },
      { name: 'system_settings', model: SystemSettingModel, records: [] },
      { name: 'user_settings', model: UserSettingModel, records: [] },
      { name: 'hotel_credits', model: HotelCreditModel, records: [] },
      { name: 'personal_access_tokens', model: PersonalAccessTokenModel, records: [] },
    ];

    for (const collection of collections) {
      const records = Array.isArray(collection.records) ? collection.records : [];
      if (records.length === 0) {
        console.log(`Inserted 0 documents for ${collection.name}`);
        continue;
      }

      const inserted = await (collection.model as any).insertMany(records);
      console.log(`Inserted ${inserted.length} documents for ${collection.name}`);
    }

    console.log('Migration complete.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

void migrate();
