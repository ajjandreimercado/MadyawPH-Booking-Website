import {
  extractStoragePath,
  hotelMediaProxyUrl,
  pickImageSource,
  resolveHotelImageUrl,
  shouldProxyHotelImage,
} from '../utils/hotelImageUrl';

describe('hotelImageUrl', () => {
  beforeEach(() => {
    process.env.HOTEL_APP_PUBLIC_URL = 'https://madyawph.onrender.com';
    process.env.MADYAW_API_PUBLIC_URL = 'https://madyaw-api.onrender.com/api';
  });

  it('keeps external CDN URLs unchanged', () => {
    const url = 'https://images.unsplash.com/photo-123?w=800';
    expect(resolveHotelImageUrl(url)).toBe(url);
    expect(shouldProxyHotelImage(url)).toBe(false);
  });

  it('extracts storage path from chat/media URLs', () => {
    const raw = 'https://madyawph.onrender.com/api/v1/chat/media?f=categories%2Fabc.jpg';
    expect(extractStoragePath(raw)).toBe('categories/abc.jpg');
    expect(resolveHotelImageUrl(raw)).toBe(
      'https://madyaw-api.onrender.com/api/hotels/media?f=categories%2Fabc.jpg',
    );
  });

  it('proxies relative room paths', () => {
    expect(resolveHotelImageUrl('/rooms/room-101.jpg')).toBe(
      'https://madyaw-api.onrender.com/api/hotels/media?f=rooms%2Froom-101.jpg',
    );
    expect(resolveHotelImageUrl('rooms/room-101.jpg')).toBe(
      'https://madyaw-api.onrender.com/api/hotels/media?f=rooms%2Froom-101.jpg',
    );
  });

  it('picks the first available image field from hotel records', () => {
    expect(pickImageSource({ image_url: 'rooms/a.jpg' })).toBe('rooms/a.jpg');
    expect(pickImageSource({ image: 'rooms/b.jpg' })).toBe('rooms/b.jpg');
    expect(pickImageSource({ images: ['rooms/c.jpg'] })).toBe('rooms/c.jpg');
  });

  it('builds media proxy URLs', () => {
    expect(hotelMediaProxyUrl('categories/test.jpg')).toBe(
      'https://madyaw-api.onrender.com/api/hotels/media?f=categories%2Ftest.jpg',
    );
  });
});
