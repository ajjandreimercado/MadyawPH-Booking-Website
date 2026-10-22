import './testSetup';
import { resolveRecordImages, serializeProperty } from '../utils/serialize';

describe('hotel app room photos', () => {
  it('reads every photo in the hotel app image_urls list, deduped', () => {
    const record = {
      image_url: 'https://images.example.com/a.jpg',
      image_urls: ['https://images.example.com/a.jpg', 'https://images.example.com/b.jpg'],
    };
    expect(resolveRecordImages(record)).toEqual([
      'https://images.example.com/a.jpg',
      'https://images.example.com/b.jpg',
    ]);
  });

  it('reads image_urls when the hotel app stored it as a JSON string', () => {
    const record = { image_urls: '["https://images.example.com/x.jpg","https://images.example.com/y.jpg"]' };
    expect(resolveRecordImages(record)).toHaveLength(2);
    expect(serializeProperty({ _id: 'r2', ...record } as never).image).toBe('https://images.example.com/x.jpg');
  });

  it('keeps all of a room\'s photos on the serialized room', () => {
    const room = serializeProperty({ _id: 'r1', image_urls: ['https://images.example.com/one.jpg', 'https://images.example.com/two.jpg'] } as never);
    expect(room.image).toBe('https://images.example.com/one.jpg');
    expect(room.images).toHaveLength(2);
  });
});
