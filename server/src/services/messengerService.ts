/**
 * Meta Messenger Send API helpers.
 */

const GRAPH_API = 'https://graph.facebook.com/v21.0';

export interface MessengerSendPayload {
  recipient: { id: string };
  messaging_type?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
  message: Record<string, unknown>;
}

type SenderActionPayload = {
  recipient: { id: string };
  sender_action: 'mark_seen' | 'typing_on' | 'typing_off';
};

export async function sendMessengerPayload(
  pageAccessToken: string,
  payload: MessengerSendPayload,
): Promise<boolean> {
  const url = `${GRAPH_API}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('[Messenger] Send failed:', response.status, body.slice(0, 500));
    return false;
  }

  return true;
}

async function sendSenderAction(
  pageAccessToken: string,
  payload: SenderActionPayload,
): Promise<void> {
  const url = `${GRAPH_API}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('[Messenger] Sender action failed:', response.status, body.slice(0, 500));
  }
}

export async function sendText(recipientId: string, pageAccessToken: string, text: string): Promise<void> {
  await sendMessengerPayload(pageAccessToken, {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: { text },
  });
}

export async function sendQuickReplies(
  recipientId: string,
  pageAccessToken: string,
  text: string,
  replies: Array<{ title: string; payload: string }>,
): Promise<void> {
  await sendMessengerPayload(pageAccessToken, {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: {
      text,
      quick_replies: replies.slice(0, 13).map((r) => ({
        content_type: 'text',
        title: r.title.slice(0, 20),
        payload: r.payload.slice(0, 1000),
      })),
    },
  });
}

export async function sendButtonTemplate(
  recipientId: string,
  pageAccessToken: string,
  text: string,
  buttons: Array<{ type: 'web_url'; title: string; url: string } | { type: 'postback'; title: string; payload: string }>,
): Promise<void> {
  await sendMessengerPayload(pageAccessToken, {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: text.slice(0, 640),
          buttons: buttons.slice(0, 3).map((b) => {
            if (b.type === 'web_url') {
              return { type: 'web_url', title: b.title.slice(0, 20), url: b.url };
            }
            return { type: 'postback', title: b.title.slice(0, 20), payload: b.payload.slice(0, 1000) };
          }),
        },
      },
    },
  });
}

export async function markSeen(recipientId: string, pageAccessToken: string): Promise<void> {
  await sendSenderAction(pageAccessToken, {
    recipient: { id: recipientId },
    sender_action: 'mark_seen',
  });
}

export async function typingOn(recipientId: string, pageAccessToken: string): Promise<void> {
  await sendSenderAction(pageAccessToken, {
    recipient: { id: recipientId },
    sender_action: 'typing_on',
  });
}
