import './testSetup';
import request from 'supertest';
import app from '../app';

describe('CSRF origin guard', () => {
  it('blocks browser POSTs from unknown origins', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.com', password: 'password12345' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/could not be completed/i);
  });

  it('allows server-to-server webhook posts without Origin', async () => {
    process.env.HOTEL_WEBHOOK_SECRET = 'test-hotel-webhook-secret-value-32chars!!';

    const res = await request(app)
      .post('/api/bookings/hotel-events')
      .set('Authorization', 'Bearer test-hotel-webhook-secret-value-32chars!!')
      .send({ status: 'approved' });

    expect(res.status).not.toBe(403);
  });
});
