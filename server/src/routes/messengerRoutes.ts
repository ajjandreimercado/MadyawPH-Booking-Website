import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { getMessengerAppSecret, getMessengerPageAccessToken, getMessengerVerifyToken, isMessengerEnabled } from '../config/env';
import { messengerWebhookLimiter } from '../middleware/rateLimiters';
import { handleMessengerEvent } from '../services/messengerBot';
import { timingSafeEqualString } from '../utils/bookingFileAccess';

const messengerRoutes = Router();

/**
 * Verify Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret).
 * Enforced whenever MESSENGER_APP_SECRET is configured; without it Meta payloads
 * cannot be trusted, so production should always set it (see server/.env.example).
 */
function hasValidMetaSignature(req: Request): boolean {
  const appSecret = getMessengerAppSecret();
  if (!appSecret) return true; // Not configured — logged once at route level below.
  const header = String(req.header('x-hub-signature-256') ?? '');
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !header.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return timingSafeEqualString(header, expected);
}

/**
 * Meta webhook verification (GET).
 * https://developers.facebook.com/docs/messenger-platform/webhooks
 */
messengerRoutes.get('/webhook', (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] ?? '');
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = req.query['hub.challenge'];

  const verifyToken = getMessengerVerifyToken();
  if (!verifyToken) {
    return res.status(503).json({ message: 'Messenger verify token is not configured.' });
  }

  if (mode === 'subscribe' && token && timingSafeEqualString(token, verifyToken) && challenge != null) {
    console.log('[Messenger] Webhook verified');
    return res.status(200).send(String(challenge));
  }

  console.warn('[Messenger] Webhook verification failed');
  return res.sendStatus(403);
});

/**
 * Meta webhook events (POST). Respond 200 immediately; process async.
 */
messengerRoutes.post('/webhook', messengerWebhookLimiter, (req: Request, res: Response) => {
  if (!isMessengerEnabled()) {
    return res.status(503).json({ message: 'Messenger is not configured.' });
  }

  // Reject spoofed events when an app secret is configured (OWASP A08 integrity).
  if (!hasValidMetaSignature(req)) {
    console.warn('[Messenger] Webhook rejected: invalid X-Hub-Signature-256');
    return res.sendStatus(403);
  }
  if (!getMessengerAppSecret()) {
    console.warn('[Messenger] MESSENGER_APP_SECRET is not set — webhook signatures are not verified.');
  }

  res.status(200).send('EVENT_RECEIVED');

  const body = req.body as {
    object?: string;
    entry?: Array<{ messaging?: Array<Record<string, unknown>> }>;
  };

  if (body.object !== 'page' || !Array.isArray(body.entry)) {
    console.warn('[Messenger] Ignored webhook payload:', body.object ?? 'unknown');
    return undefined;
  }

  const eventCount = body.entry.reduce((n, entry) => n + (entry.messaging?.length ?? 0), 0);
  console.log('[Messenger] Webhook received:', eventCount, 'event(s)');

  void (async () => {
    try {
      for (const entry of body.entry ?? []) {
        for (const event of entry.messaging ?? []) {
          await handleMessengerEvent(event as {
            sender?: { id?: string };
            message?: { text?: string; is_echo?: boolean; quick_reply?: { payload?: string } };
            postback?: { payload?: string };
          });
        }
      }
    } catch (error) {
      console.error('[Messenger] Event handling failed:', error);
    }
  })();

  return undefined;
});

/** Health hint for operators (no secrets). */
messengerRoutes.get('/status', (_req, res) => {
  res.json({
    enabled: isMessengerEnabled(),
    hasPageToken: Boolean(getMessengerPageAccessToken()),
    hasVerifyToken: Boolean(getMessengerVerifyToken()),
  });
});

export default messengerRoutes;
