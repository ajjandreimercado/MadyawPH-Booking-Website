import { resolveRecordImages, serializeRoomCategory } from '../utils/serialize';

describe('resolveRecordImages', () => {
  it('returns every uploaded photo of a room type, deduped', () => {
    const urls = resolveRecordImages({
      images: ['rooms/a.jpg', 'rooms/b.jpg'],
      image_url: 'rooms/a.jpg',
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('rooms%2Fa.jpg');
    expect(urls[1]).toContain('rooms%2Fb.jpg');
  });

  it('falls back to the single image field', () => {
    const urls = resolveRecordImages({ image_url: 'categories/cover.jpg' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('categories%2Fcover.jpg');
  });

  it('returns nothing when the hotel attached no photo', () => {
    expect(resolveRecordImages({})).toEqual([]);
    expect(resolveRecordImages(null)).toEqual([]);
  });
});

describe('serializeRoomCategory', () => {
  it('exposes the category gallery as images', () => {
    const category = serializeRoomCategory({
      _id: 'cat-1',
      hotel_id: 'hotel-1',
      name: 'Deluxe',
      default_price: 2500,
      images: ['rooms/a.jpg', 'rooms/b.jpg'],
    } as never);
    expect(category.images).toHaveLength(2);
    expect(category.imageUrl).toContain('rooms%2Fa.jpg');
  });
});
