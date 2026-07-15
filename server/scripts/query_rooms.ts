import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/db';
import { PropertyModel, HotelModel, RoomCategoryModel, UserModel, BookingModel, ReviewModel } from '../src/data/mongoModels';

async function test() {
  await connectDatabase();
  try {
    const hotelsCount = await HotelModel.countDocuments();
    const categoriesCount = await RoomCategoryModel.countDocuments();
    const roomsCount = await PropertyModel.countDocuments();
    const usersCount = await UserModel.countDocuments();
    const bookingsCount = await BookingModel.countDocuments();
    const reviewsCount = await ReviewModel.countDocuments();

    console.log('--- Collection Counts ---');
    console.log('Hotels:', hotelsCount);
    console.log('RoomCategories:', categoriesCount);
    console.log('Rooms (PropertyModel):', roomsCount);
    console.log('Users:', usersCount);
    console.log('Bookings:', bookingsCount);
    console.log('Reviews:', reviewsCount);

    console.log('\n--- Sample Rooms ---');
    const rooms = await PropertyModel.find().limit(3).lean();
    console.log(JSON.stringify(rooms, null, 2));

    console.log('\n--- Sample Hotels ---');
    const hotels = await HotelModel.find().limit(2).lean();
    console.log(JSON.stringify(hotels, null, 2));

    console.log('\n--- Sample Categories ---');
    const cats = await RoomCategoryModel.find().limit(2).lean();
    console.log(JSON.stringify(cats, null, 2));

  } catch (error) {
    console.error('Error querying:', error);
  } finally {
    await mongoose.disconnect();
  }
}

void test();
