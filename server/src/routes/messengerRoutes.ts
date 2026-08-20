import { Router, type Request, type Response } from 'express';
import { getMessengerPageAccessToken, getMessengerVerifyToken, isMessengerEnabled } from '../config/env';
import { messengerWebhookLimiter } from '../middleware/rateLimiters';
import { handleMessengerEvent } from '../services/messengerBot';

const messengerRoutes = Router();

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

  if (mode === 'subscribe' && token === verifyToken && challenge != null) {
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
