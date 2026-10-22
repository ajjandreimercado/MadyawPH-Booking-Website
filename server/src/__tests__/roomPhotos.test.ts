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

  it('keeps all of a room\'s photos on the serialized room', () => {
    const room = serializeProperty({ _id: 'r1', image_urls: ['https://images.example.com/one.jpg', 'https://images.example.com/two.jpg'] } as never);
    expect(room.image).toBe('https://images.example.com/one.jpg');
    expect(room.images).toHaveLength(2);
  });
});
