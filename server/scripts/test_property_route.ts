import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/db';
import { PropertyModel } from '../src/data/mongoModels';
import { serializeProperty } from '../src/utils/serialize';

async function testRoute() {
  await connectDatabase();
  try {
    // Simulate query: hotelId=hotel-1, limit=50
    const hotelId = 'hotel-1';
    const limit = '50';

    const filter: Record<string, unknown> = {};
    const normalizedHotelId = typeof hotelId === 'string' && hotelId.trim() ? hotelId.trim() : null;

    const numericLimit = Number(limit);
    const safeLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? Math.min(numericLimit, 50) : 50;

    const sortStage: Record<string, 1 | -1> = { status: 1, room_number: 1 };

    const query = PropertyModel.find(filter).sort(sortStage);

    if (!normalizedHotelId) {
      query.limit(safeLimit);
    }

    const filteredSample = await query.lean();
    console.log('Query result count (before serialization/filtering):', filteredSample.length);
    console.log('Raw Query results:', JSON.stringify(filteredSample, null, 2));

    const serialized = filteredSample.map(property => serializeProperty(property as never));
    console.log('Serialized sample hotelIds:', serialized.map(s => s.hotelId));

    const byHotel = normalizedHotelId
      ? serialized.filter((property) => property.hotelId === normalizedHotelId)
      : serialized;

    console.log('Filtered by hotel count:', byHotel.length);
    console.log('Final output:', JSON.stringify(byHotel.slice(0, safeLimit), null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

void testRoute();
