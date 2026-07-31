import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { HotelModel, RoomCategoryModel, PropertyModel } from '../src/data/mongoModels';

dotenv.config();

/**
 * Partially destructive for one hotel's rooms/categories.
 * Refuses to run unless CONFIRM_DESTRUCTIVE_SEED=YES.
 */
if (process.env.CONFIRM_DESTRUCTIVE_SEED !== 'YES') {
  console.error(
    '[seed_real_data] Aborted. This script deletes room/category docs for a hotel before reseeding.\n' +
      'Set CONFIRM_DESTRUCTIVE_SEED=YES only if you intentionally want that.',
  );
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/madyaw';

async function seedRealData() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');

    // 1. Find Gloreto
    const gloreto = await HotelModel.findOne({ name: 'Gloreto' });
    if (!gloreto) {
      console.log('Gloreto not found, skipping seed.');
      process.exit(0);
    }

    const hotelId = String(gloreto._id);

    // 2. Clear dummy properties for Gloreto
    await RoomCategoryModel.deleteMany({ hotel_id: hotelId });
    await PropertyModel.deleteMany({ hotel_id: hotelId });

    // 3. Create a real Room Category
    const category = await RoomCategoryModel.create({
      hotel_id: hotelId,
      name: 'Deluxe Suite',
      description: 'A spacious and luxurious suite perfect for couples or solo travelers looking for extra comfort.',
      default_price: 3500,
      image_url: '/hero/slide-1.jpg',
    });

    // 4. Create real Rooms
    await PropertyModel.create([
      {
        hotel_id: hotelId,
        hotel_name: gloreto.name,
        hotel_location: gloreto.location,
        category_id: String(category._id),
        category_name: category.name,
        display_name: 'Deluxe Suite - Ocean View',
        room_number: '101',
        room_type: 'deluxe-suite',
        price_per_night: 3500,
        status: 'available',
        amenities: ['wifi', 'air-conditioning', 'breakfast-included'],
        image_url: '/hero/slide-1.jpg',
        description: 'Enjoy sweeping views of the ocean from your private balcony.',
        free_cancellation: true,
        breakfast_included: true,
        max_guests: 2,
        bed_configuration: '1 King Bed',
      },
      {
        hotel_id: hotelId,
        hotel_name: gloreto.name,
        hotel_location: gloreto.location,
        category_id: String(category._id),
        category_name: category.name,
        display_name: 'Deluxe Suite - Garden View',
        room_number: '102',
        room_type: 'deluxe-suite',
        price_per_night: 3200,
        status: 'available',
        amenities: ['wifi', 'air-conditioning'],
        image_url: '/hero/slide-2.jpg',
        description: 'A peaceful suite overlooking our lush tropical gardens.',
        free_cancellation: false,
        breakfast_included: false,
        max_guests: 2,
        bed_configuration: '2 Queen Beds',
      }
    ]);

    console.log('Successfully seeded real data for Gloreto!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding data:', error);
    process.exit(1);
  }
}

seedRealData();
