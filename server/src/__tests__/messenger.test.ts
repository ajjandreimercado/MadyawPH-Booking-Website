import './testSetup';
import request from 'supertest';
import app from '../app';

describe('Messenger webhook', () => {
  const previousVerify = process.env.MESSENGER_VERIFY_TOKEN;
  const previousToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;

  beforeAll(() => {
    process.env.MESSENGER_VERIFY_TOKEN = 'test-verify-token';
    process.env.MESSENGER_PAGE_ACCESS_TOKEN = 'test-page-token';
  });

  afterAll(() => {
    if (previousVerify === undefined) delete process.env.MESSENGER_VERIFY_TOKEN;
    else process.env.MESSENGER_VERIFY_TOKEN = previousVerify;
    if (previousToken === undefined) delete process.env.MESSENGER_PAGE_ACCESS_TOKEN;
    else process.env.MESSENGER_PAGE_ACCESS_TOKEN = previousToken;
  });

  it('verifies Meta webhook challenge when token matches', async () => {
    const res = await request(app)
      .get('/api/messenger/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test-verify-token',
        'hub.challenge': 'challenge-12345',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-12345');
  });

  it('rejects webhook verification with wrong token', async () => {
    const res = await request(app)
      .get('/api/messenger/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong',
        'hub.challenge': 'challenge-12345',
      });

    expect(res.status).toBe(403);
  });

  it('returns messenger status without secrets', async () => {
    const res = await request(app).get('/api/messenger/status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.hasVerifyToken).toBe(true);
    expect(res.body.hasPageToken).toBe(true);
  });
});
