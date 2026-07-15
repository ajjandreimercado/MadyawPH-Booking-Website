import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const dataFilePath = path.resolve(__dirname, '../../data/localDatabase.json');

interface LocalDatabase {
  hotels: Record<string, unknown>[];
  roomCategories: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  users: Record<string, unknown>[];
  bookings: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
}

export interface LocalDocumentMethods {
  save(): Promise<this>;
  toObject(): Record<string, unknown>;
}

export type LocalRecord<T extends Record<string, unknown>> = T & LocalDocumentMethods;

export interface HotelDocument {
  _id: string;
  name: string;
  location: string;
  contact_number: string;
  access_username: string;
  access_password: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomCategoryDocument {
  _id: string;
  hotel_id: string;
  name: string;
  description: string;
  default_price: number;
  image_url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyDocument {
  _id: string;
  hotel_id: string;
  hotel_name: string;
  hotel_location: string;
  category_id: string;
  category_name: string;
  display_name: string;
  room_number: string;
  room_type: string;
  price_per_night: number;
  status: string;
  amenities: string[];
  image_url: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDocument {
  _id: string;
  hotel_id?: string;
  booking_id?: string;
  room_id?: string;
  guest_name?: string;
  propertyId?: string;
  authorName: string;
  rating: number;
  title: string;
  comment: string;
  submitted_at?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BookingDocument {
  _id: string;
  booking_reference: string;
  hotel_id?: string;
  room_id?: string;
  propertyId: string;
  propertyName: string;
  guestName: string;
  guestEmail: string;
  guest_phone: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  infants: number;
  roomType: string;
  paymentMethod: string;
  source: string;
  booking_type: string;
  nights: number;
  guestCount: number;
  roomRate: number;
  serviceFee: number;
  totalPrice: number;
  total_amount: number;
  discount_amount: number;
  discount_reason?: string;
  status: string;
  requestedAt: string;
  expiresAt: string;
  check_in_at?: string;
  check_out_at?: string;
  payment_status?: string;
  createdAt?: string;
  updatedAt?: string;
  confirmationSentAt?: string | null;
  confirmationSendStatus?: 'none' | 'sent' | 'failed';
  confirmationSendError?: string;
}

export interface UserDocument {
  _id: string;
  hotel_id?: string;
  name: string;
  email: string;
  password: string;
  role: 'guest' | 'partner' | 'admin' | 'staff' | 'super_admin';
  partner?: unknown;
  authProvider?: string;
  googleSub?: string;
  favorites?: string[];
  createdAt?: string;
  updatedAt?: string;
}

let database: LocalDatabase = {
  hotels: [],
  roomCategories: [],
  properties: [],
  users: [],
  bookings: [],
  reviews: [],
};

function normalize(value: unknown) {
  return value === null || value === undefined ? '' : String(value);
}

function matchesCondition(fieldValue: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof RegExp)) {
    if ('$gte' in condition || '$lte' in condition || '$gt' in condition || '$lt' in condition) {
      const value = Number(fieldValue);
      if ('$gte' in condition && value < Number((condition as any).$gte)) {
        return false;
      }
      if ('$lte' in condition && value > Number((condition as any).$lte)) {
        return false;
      }
      if ('$gt' in condition && value <= Number((condition as any).$gt)) {
        return false;
      }
      if ('$lt' in condition && value >= Number((condition as any).$lt)) {
        return false;
      }
      return true;
    }

    if ('$in' in condition) {
      const values = Array.isArray((condition as any).$in) ? (condition as any).$in : [];
      return values.some((allowed) => normalize(allowed) === normalize(fieldValue));
    }

    if ('$all' in condition) {
      const values = Array.isArray((condition as any).$all) ? (condition as any).$all : [];
      const actual = Array.isArray(fieldValue) ? fieldValue.map(normalize) : [normalize(fieldValue)];
      return values.every((value) => actual.includes(normalize(value)));
    }

    if ('$expr' in condition) {
      return true;
    }

    return Object.keys(condition).every((key) => matchesCondition(fieldValue, (condition as any)[key]));
  }

  if (condition instanceof RegExp) {
    return typeof fieldValue === 'string' ? condition.test(fieldValue) : false;
  }

  return normalize(fieldValue) === normalize(condition);
}

function matchesDocument(document: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  const filterKeys = Object.keys(filter);

  if (filterKeys.length === 0) {
    return true;
  }

  return filterKeys.every((key) => {
    if (key === '$or') {
      const conditions = Array.isArray(filter.$or) ? filter.$or : [];
      return conditions.some((condition) => matchesDocument(document, condition as Record<string, unknown>));
    }

    if (key === '$and') {
      const conditions = Array.isArray(filter.$and) ? filter.$and : [];
      return conditions.every((condition) => matchesDocument(document, condition as Record<string, unknown>));
    }

    const expected = filter[key];
    const actual = document[key];
    return matchesCondition(actual, expected);
  });
}

function cloneSelected(document: Record<string, unknown>, selection?: Record<string, unknown>) {
  if (!selection) {
    return { ...document };
  }

  const selected: Record<string, unknown> = {};
  Object.keys(selection).forEach((key) => {
    if ((selection as any)[key]) {
      selected[key] = document[key];
    }
  });

  if (!Object.prototype.hasOwnProperty.call(selection, '_id')) {
    selected._id = document._id;
  }

  return selected;
}

function sortDocuments(items: Record<string, unknown>[], sortObj: Record<string, 1 | -1>) {
  return [...items].sort((a, b) => {
    for (const key of Object.keys(sortObj)) {
      const direction = sortObj[key];
      const aValue = a[key];
      const bValue = b[key];

      if (aValue === bValue) {
        continue;
      }

      if (aValue === undefined || aValue === null) {
        return direction === 1 ? -1 : 1;
      }

      if (bValue === undefined || bValue === null) {
        return direction === 1 ? 1 : -1;
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return direction === 1 ? aValue - bValue : bValue - aValue;
      }

      return direction === 1
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    }

    return 0;
  });
}

async function saveDatabase() {
  await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
  await fs.writeFile(dataFilePath, JSON.stringify(database, null, 2), 'utf8');
}

async function loadDatabase() {
  try {
    const content = await fs.readFile(dataFilePath, 'utf8');
    const parsed = JSON.parse(content) as LocalDatabase;
    database = {
      hotels: Array.isArray(parsed.hotels) ? parsed.hotels : [],
      roomCategories: Array.isArray(parsed.roomCategories) ? parsed.roomCategories : [],
      properties: Array.isArray(parsed.properties) ? parsed.properties : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
    };
  } catch {
    await saveDatabase();
  }
}

function wrapDocument(collection: Record<string, unknown>[], item: Record<string, unknown> | undefined | null) {
  if (!item) {
    return null;
  }

  const document = item as Record<string, unknown>;

  return Object.assign(document, {
    async save() {
      document.updatedAt = new Date().toISOString();
      await saveDatabase();
      return this;
    },
    toObject() {
      return { ...document };
    },
  });
}

class LocalDocumentQuery {
  private selection?: Record<string, unknown>;
  private leanMode = false;

  constructor(
    private readonly collection: Record<string, unknown>[],
    private readonly document: Record<string, unknown> | undefined | null,
  ) {}

  select(selection: Record<string, unknown>) {
    this.selection = selection;
    return this;
  }

  lean() {
    this.leanMode = true;
    return this;
  }

  async execute() {
    if (!this.document) {
      return null;
    }

    if (this.leanMode) {
      return cloneSelected(this.document, this.selection);
    }

    if (this.selection) {
      const result = cloneSelected(this.document, this.selection);
      return wrapDocument(this.collection, result as Record<string, unknown>);
    }

    return wrapDocument(this.collection, this.document);
  }

  then<TResult1 = unknown, TResult2 = never>(
    resolve: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>),
  ) {
    return this.execute().then(resolve, reject);
  }
}

class LocalQuery {
  private selection?: Record<string, unknown>;
  private sortObj?: Record<string, 1 | -1>;
  private limitCount?: number;

  constructor(private readonly items: Record<string, unknown>[], private readonly filter: Record<string, unknown>) {}

  sort(sortObj: Record<string, 1 | -1>) {
    this.sortObj = sortObj;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  select(selection: Record<string, unknown>) {
    this.selection = selection;
    return this;
  }

  lean() {
    let results = this.items.filter((item) => matchesDocument(item, this.filter));

    if (this.sortObj) {
      results = sortDocuments(results, this.sortObj);
    }

    if (this.limitCount !== undefined) {
      results = results.slice(0, this.limitCount);
    }

    return Promise.resolve(results.map((item) => cloneSelected(item, this.selection)));
  }
}

class LocalCollection {
  constructor(private readonly getItems: () => Record<string, unknown>[]) {}

  find(filter: Record<string, unknown> = {}) {
    return new LocalQuery(this.getItems(), filter);
  }

  async findOne(filter: Record<string, unknown>) {
    const document = this.getItems().find((item) => matchesDocument(item, filter));
    return wrapDocument(this.getItems(), document);
  }

  findById(id: string) {
    const document = this.getItems().find((item) => normalize(item._id) === normalize(id));
    return new LocalDocumentQuery(this.getItems(), document ?? null);
  }

  async create(data: Record<string, unknown>) {
    const item: Record<string, unknown> = {
      ...data,
      _id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.getItems().push(item);
    await saveDatabase();
    return wrapDocument(this.getItems(), item);
  }
}

export const HotelModel: any = new LocalCollection(() => database.hotels);
export const RoomCategoryModel: any = new LocalCollection(() => database.roomCategories);
export const PropertyModel: any = new LocalCollection(() => database.properties);
export const UserModel: any = new LocalCollection(() => database.users);
export const BookingModel: any = new LocalCollection(() => database.bookings);
export const ReviewModel: any = new LocalCollection(() => database.reviews);

export async function initializeLocalStore() {
  await loadDatabase();
}
