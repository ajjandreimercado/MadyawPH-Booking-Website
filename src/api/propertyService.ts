import type { Hotel, Property, RoomCategory } from '../types';
import {
  fetchHotels as fetchHotelsApi,
  fetchRoomCategories as fetchRoomCategoriesApi,
  fetchProperties as fetchPropertiesApi,
  fetchPropertyById as fetchPropertyByIdApi,
  fetchHotelById as fetchHotelByIdApi,
  fetchHotelDetailById as fetchHotelDetailByIdApi,
  createBookingRequest,
  type HotelDetailResponse,
  type PropertyQueryParams,
  type RoomCategoryQueryParams,
  type BookingCreatePayload,
} from '../services/api';

export type { PropertyQueryParams, RoomCategoryQueryParams } from '../services/api';

export async function createBookingRequestApi(payload: BookingCreatePayload) {
  return createBookingRequest(payload);
}

export async function fetchProperties(params: PropertyQueryParams = {}): Promise<Property[]> {
  return fetchPropertiesApi(params);
}

export async function fetchHotels(): Promise<Hotel[]> {
  return fetchHotelsApi();
}

export async function fetchRoomCategories(params: RoomCategoryQueryParams = {}): Promise<RoomCategory[]> {
  return fetchRoomCategoriesApi(params);
}

export async function fetchPropertyById(propertyId: string): Promise<Property> {
  return fetchPropertyByIdApi(propertyId);
}

export async function fetchHotelById(hotelId: string, options?: { force?: boolean }): Promise<Hotel> {
  return fetchHotelByIdApi(hotelId, options);
}

export async function fetchHotelDetailById(hotelId: string): Promise<HotelDetailResponse> {
  return fetchHotelDetailByIdApi(hotelId);
}