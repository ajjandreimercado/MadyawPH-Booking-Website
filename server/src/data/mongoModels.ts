import mongoose, { Schema, model } from 'mongoose';

const { Types } = mongoose;
const Mixed = Schema.Types.Mixed;
const ObjectId = Schema.Types.ObjectId;
const schemaOptions = { timestamps: true };

const hotelSchema = new Schema(
  {
    // Hotels in Atlas use ObjectId _id — do NOT override to String or findById() breaks
    name: { type: String, required: true },
    location: { type: String, required: true },
    city: { type: String },
    neighborhood: { type: String },
    landmarks: [{ type: String }],
    coordinates: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    contact_number: { type: String },
    access_username: { type: String },
    access_password: { type: String },
    image_url: { type: String },
  },
  schemaOptions,
);

const roomCategorySchema = new Schema(
  {
    hotel_id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    default_price: { type: Number, required: true },
    image_url: { type: String, required: true },
  },
  schemaOptions,
);

const roomSchema = new Schema(
  {
    hotel_id: { type: String, required: true, index: true },
    hotel_name: { type: String },
    hotel_location: { type: String },
    category_id: { type: String, required: true },
    category_name: { type: String, required: true },
    display_name: { type: String, required: true },
    room_number: { type: String, required: true },
    room_type: { type: String, required: true },
    price_per_night: { type: Number, required: true },
    status: { type: String, required: true },
    amenities: [{ type: String }],
    image_url: { type: String, required: true },
    description: { type: String },
    free_cancellation: { type: Boolean, default: false },
    breakfast_included: { type: Boolean, default: false },
    max_guests: { type: Number, default: 2 },
    bed_configuration: { type: String, default: '1 King Bed' },
    current_guest_name: { type: String, default: '' },
    current_check_in: { type: Date },
    current_check_out: { type: Date },
    current_access_code: { type: String, default: '' },
  },
  schemaOptions,
);

const bookingSchema = new Schema(
  {
    booking_reference: { type: String, required: true, index: true, unique: true },
    hotel_id: { type: String, required: true, index: true },
    room_id: { type: Schema.Types.Mixed, required: true },
    propertyId: { type: String, required: true, index: true },
    propertyName: { type: String },
    guestName: { type: String, required: true },
    // Hotel management app (shared Mongo) also reads snake_case aliases below.
    guest_name: { type: String },
    // index allows fast lookup of a guest's own bookings
    guestEmail: { type: String, required: true, index: true },
    guest_email: { type: String },
    guest_phone: { type: String, required: true },
    // Website API uses camelCase string dates (yyyy-MM-dd).
    checkInDate: { type: String, required: true },
    checkOutDate: { type: String, required: true },
    // Hotel app schedule/queue reads Date fields (same pattern as external_reservations).
    check_in_date: { type: Date },
    check_out_date: { type: Date },
    check_in_time: { type: String, default: '14:00' },
    check_out_time: { type: String, default: '12:00' },
    adults: { type: Number, default: 1 },
    children: { type: Number, default: 0 },
    infants: { type: Number, default: 0 },
    nights: { type: Number, required: true },
    guestCount: { type: Number, required: true },
    roomType: { type: String, required: true },
    paymentMethod: { type: String, required: true },
    roomRate: { type: Number, required: true },
    payment_status: { type: String, default: 'unpaid' },
    amountPaid: { type: Number, required: true },
    // Hotel app partial-payment fields
    amount_paid: { type: Number },
    balance_due: { type: Number },
    deposit_amount: { type: Number },
    totalPrice: { type: Number, required: true },
    total_amount: { type: Number, required: true },
    serviceFee: { type: Number, default: 0 },
    source: { type: String, required: true },
    booking_type: { type: String, required: true },
    // Hotel app source channel (e.g. admin-walk-in, app-customer, website-customer)
    booking_source: { type: String },
    billing_mode: { type: String },
    // Snake_case payment alias (hotel app); website still uses paymentMethod
    payment_method: { type: String },
    status: { type: String, required: true },
    // Hotel report/forms require an explicit boolean (missing value fails validation).
    summary_only: { type: Boolean, default: false },
    discount_type: { type: String, default: '' },
    discount_value: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },
    discount_reason: { type: String, default: '' },
    requestedAt: { type: Date },
    expiresAt: { type: Date },
    check_in_at: { type: Date },
    check_out_at: { type: Date },
    // Hotel app "Date booked" reads created_at (not only mongoose createdAt)
    created_at: { type: Date },
    updated_at: { type: Date },
    special_requests: { type: String, default: '' },
    promo_code: { type: String, default: '' },
    confirmationSentAt: { type: Date, default: null },
    confirmationSendStatus: { type: String, enum: ['none', 'sent', 'failed'], default: 'none' },
    confirmationSendError: { type: String, default: '' },
  },
  schemaOptions,
);


const promoCodeSchema = new Schema(
  {
    _id: { type: String },
    code: { type: String, required: true, unique: true, index: true },
    discount_type: { type: String, enum: ['percentage', 'fixed'], required: true },
    discount_value: { type: Number, required: true },
    min_booking_amount: { type: Number, default: 0 },
    max_uses: { type: Number, default: 0 }, // 0 = unlimited
    uses_count: { type: Number, default: 0 },
    expires_at: { type: Date },
    is_active: { type: Boolean, default: true },
    description: { type: String, default: '' },
  },
  schemaOptions,
);

const externalReservationSchema = new Schema(
  {
    // Do not force String _id — hotel app uses ObjectId documents in external_reservations.
    hotel_id: { type: String, required: true, index: true },
    source: { type: String, required: true, index: true },
    external_reference: { type: String, required: true, index: true },
    guest_name: { type: String, required: true },
    guest_email: { type: String, required: true },
    guest_phone: { type: String, required: true },
    check_in_date: { type: Date, required: true },
    check_out_date: { type: Date, required: true },
    status: { type: String, required: true, index: true },
    assigned_room_id: { type: String },
    booking_id: { type: String, index: true },
    // Hotel app stores metadata as a JSON string (PHP json_encode).
    metadata: { type: Schema.Types.Mixed, default: {} },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

const billingChargeSchema = new Schema(
  {
    hotel_id: { type: String, required: true, index: true },
    booking_id: { type: String, required: true, index: true },
    room_id: { type: String, required: true },
    type: {
      type: String,
      enum: ['room', 'amenity', 'refund', 'early-check-in', 'late-checkout', 'manual', 'partial_payment'],
      required: true,
    },
    label: { type: String, required: true },
    amount: { type: Schema.Types.Mixed, required: true },
    quantity: { type: Number, required: true, default: 1 },
    is_manual: { type: Boolean, default: false },
    created_by: { type: String },
    metadata: { type: Mixed, default: {} },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

const roomTransferSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    booking_id: { type: String, required: true },
    from_room_id: { type: String, required: true },
    to_room_id: { type: String, required: true },
    price_adjustment: { type: Number, required: true },
    reason: { type: String, required: true },
    transferred_by: { type: String, required: true },
    transferred_at: { type: Date, required: true },
  },
  schemaOptions,
);

const checkoutReminderSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    booking_id: { type: String, required: true },
    room_id: { type: String, required: true },
    channel: { type: String, required: true },
    minutes_before_checkout: { type: Number, required: true },
    scheduled_for: { type: Date, required: true },
    sent_at: { type: Date },
    status: { type: String, required: true },
  },
  schemaOptions,
);

const stayReviewSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    booking_id: { type: String, required: true },
    room_id: { type: String, required: true },
    guest_name: { type: String, required: true },
    rating: { type: Number, required: true },
    comment: { type: String, required: true },
    submitted_at: { type: Date, required: true },
  },
  schemaOptions,
);

const reviewSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, index: true },
    booking_id: { type: String },
    room_id: { type: String },
    guest_name: { type: String },
    propertyId: { type: String, required: true },
    authorName: { type: String, required: true },
    rating: { type: Number, required: true },
    title: { type: String, required: true },
    comment: { type: String, required: true },
    submitted_at: { type: Date, default: Date.now },
  },
  schemaOptions,
);

const userSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, index: true },
    name: { type: String, required: true },
    // unique: true enforces DB-level uniqueness; index:true adds a query index.
    email: { type: String, required: true, index: true, unique: true },
    // password is OPTIONAL — OAuth-only users (Google sign-in) never set one.
    // Do NOT add `required: true` here; that would block UserModel.create() for Google users.
    password: { type: String },
    role: { type: String, enum: ['guest', 'partner', 'admin', 'staff', 'super_admin'], required: true },
    authProvider: { type: String, default: 'local' },
    // sparse: true so that documents without googleSub don't all collide at null in the unique index.
    googleSub: { type: String, sparse: true },
    // Set to true when a verified OAuth provider (e.g. Google) confirms the email.
    emailVerified: { type: Boolean, default: false },
    // Profile picture URL — populated from Google's `picture` claim on first OAuth login.
    avatar: { type: String },
    favorites: [{ type: String }],
    partner: { type: Mixed },
    // Brute-force / account-lockout fields
    failedLoginAttempts: { type: Number, default: 0 },
    failedLoginAt: { type: Number },
    lockoutUntil: { type: Number },
  },
  schemaOptions,
);

// Compound index for the Google OAuth upsert lookup: find by email then confirm googleSub.
userSchema.index({ email: 1, googleSub: 1 });


const staffMemberSchema = new Schema(
  {
    _id: { type: String },
    user_id: { type: String, required: true },
    hotel_id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    role: { type: String, required: true },
    performance_score: { type: Number, default: 0 },
    tasks_completed: { type: Number, default: 0 },
    daily_tasks: [{ type: String }],
  },
  schemaOptions,
);

const taskSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    assigned_to: { type: String, required: true },
    created_by: { type: String, required: true },
    deadline: { type: Date },
    status: { type: String, required: true },
    priority: { type: String, required: true },
  },
  schemaOptions,
);

const activityLogSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true },
    user_name: { type: String, required: true },
    action: { type: String, required: true },
    metadata: { type: Mixed, default: {} },
    created_at: { type: Date, default: Date.now },
  },
  schemaOptions,
);

const amenityMenuItemSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    amenity_type: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    is_active: { type: Boolean, default: true },
  },
  schemaOptions,
);

const amenityClaimSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    room_id: { type: String, required: true },
    room_number: { type: String, required: true },
    guest_name: { type: String, required: true },
    amenity_type: { type: String, required: true },
    amenity_name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    status: { type: String, required: true },
    claimed_at: { type: Date, required: true },
    fulfilled_at: { type: Date },
  },
  schemaOptions,
);

const guestMessageSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    room_id: { type: String, required: true },
    room_number: { type: String, required: true },
    guest_name: { type: String, required: true },
    message: { type: String, required: true },
    sender_role: { type: String, required: true },
    attachments: [{ type: Mixed }],
    is_read: { type: Boolean, default: false },
    read_at: { type: Date },
    sent_at: { type: Date, required: true },
  },
  schemaOptions,
);

const systemSettingSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    theme_color: { type: String, default: '#ffffff' },
    theme_mode: { type: String, default: 'light' },
    sound_notifications_enabled: { type: Boolean, default: true },
    surge_pricing: { type: Mixed, default: {} },
  },
  schemaOptions,
);

const userSettingSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true },
    theme_color: { type: String, default: '#ffffff' },
  },
  schemaOptions,
);

const hotelCreditSchema = new Schema(
  {
    _id: { type: String },
    hotel_id: { type: String, required: true, index: true },
    current_credits: { type: Number, default: 0 },
    warning_threshold: { type: Number, default: 0 },
    custom_markup_percentage: { type: Number, default: 0 },
    total_spent: { type: Number, default: 0 },
    transactions: [{ type: Mixed }],
  },
  schemaOptions,
);

const personalAccessTokenSchema = new Schema(
  {
    _id: { type: String },
    tokenable_type: { type: String, required: true },
    tokenable_id: { type: String, required: true },
    name: { type: String, required: true },
    token: { type: String, required: true },
    abilities: [{ type: String }],
    last_used_at: { type: Date },
    expires_at: { type: Date },
  },
  schemaOptions,
);

// 3rd argument explicitly sets the MongoDB collection name, overriding Mongoose's auto-pluralization.
// Atlas uses snake_case for some collections (room_categories, room_transfers) but Mongoose
// would generate camelCase plurals (roomcategories, roomtransfers) — we must override these.
export const HotelModel = model('Hotel', hotelSchema); // → 'hotels'
export const RoomCategoryModel = model('RoomCategory', roomCategorySchema, 'room_categories'); // Atlas uses 'room_categories'
export const PropertyModel = model('Room', roomSchema); // → 'rooms'
export const RoomModel = PropertyModel;
export const BookingModel = model('Booking', bookingSchema); // → 'bookings'
export const ExternalReservationModel = model('ExternalReservation', externalReservationSchema, 'external_reservations'); // Atlas / hotel app use snake_case
export const BillingChargeModel = model('BillingCharge', billingChargeSchema, 'billing_charges'); // Atlas / hotel app use snake_case
export const RoomTransferModel = model('RoomTransfer', roomTransferSchema, 'room_transfers'); // Atlas uses 'room_transfers'
export const CheckoutReminderModel = model('CheckoutReminder', checkoutReminderSchema); // → 'checkoutreminders'
export const StayReviewModel = model('StayReview', stayReviewSchema); // → 'stayreviews'
export const ReviewModel = model('Review', reviewSchema); // → 'reviews'
export const UserModel = model('User', userSchema); // → 'users'
export const StaffMemberModel = model('StaffMember', staffMemberSchema); // → 'staffmembers'
export const TaskModel = model('Task', taskSchema); // → 'tasks'
export const ActivityLogModel = model('ActivityLog', activityLogSchema); // → 'activitylogs'
export const AmenityMenuItemModel = model('AmenityMenuItem', amenityMenuItemSchema); // → 'amenitymenuitems'
export const AmenityClaimModel = model('AmenityClaim', amenityClaimSchema); // → 'amenityclaims'
export const GuestMessageModel = model('GuestMessage', guestMessageSchema); // → 'guestmessages'
export const SystemSettingModel = model('SystemSetting', systemSettingSchema); // → 'systemsettings'
export const UserSettingModel = model('UserSetting', userSettingSchema); // → 'usersettings'
export const HotelCreditModel = model('HotelCredit', hotelCreditSchema); // → 'hotelcredits'
export const PersonalAccessTokenModel = model('PersonalAccessToken', personalAccessTokenSchema); // → 'personalaccesstokens'
export const PromoCodeModel = model('PromoCode', promoCodeSchema); // → 'promocodes'
