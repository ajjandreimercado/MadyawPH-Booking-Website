/**
 * Messenger booking assistant — answers inquiries and links guests to madyaw.com.
 */

import Fuse from 'fuse.js';
import { HotelModel } from '../data/mongoModels';
import { getMadyawPublicUrl, getMessengerPageAccessToken } from '../config/env';
import {
  sendButtonTemplate,
  sendQuickReplies,
  sendText,
  typingOn,
} from './messengerService';

type BotStep = 'idle' | 'awaiting_destination';

interface SessionState {
  step: BotStep;
  updatedAt: number;
}

const sessions = new Map<string, SessionState>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function getSession(psid: string): SessionState {
  const existing = sessions.get(psid);
  if (existing && Date.now() - existing.updatedAt < SESSION_TTL_MS) {
    return existing;
  }
  const state: SessionState = { step: 'idle', updatedAt: Date.now() };
  sessions.set(psid, state);
  return state;
}

function setStep(psid: string, step: BotStep): void {
  sessions.set(psid, { step, updatedAt: Date.now() });
}

function siteUrl(path: string): string {
  const base = getMadyawPublicUrl().replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase();
}

function isGreeting(text: string): boolean {
  return /^(hi|hello|hey|good\s(morning|afternoon|evening)|madyaw|start|help|\?)$/.test(text);
}

function isSearchIntent(text: string): boolean {
  return /^(search|find|hotel|book|booking|stay|rooms?|browse)$/.test(text)
    || text.includes('book')
    || text.includes('hotel');
}

async function searchHotels(query: string, limit = 3) {
  const q = query.trim();
  if (!q) return [];

  const hotels = await HotelModel.find({}).lean();
  if (hotels.length === 0) return [];

  const fuse = new Fuse(hotels, {
    keys: ['name', 'location', 'city'],
    threshold: 0.45,
    ignoreLocation: true,
  });

  const fuzzy = fuse.search(q, { limit });
  if (fuzzy.length > 0) {
    return fuzzy.map((r) => r.item);
  }

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escaped, 'i');
  return hotels.filter((h) =>
    rx.test(String(h.name ?? ''))
    || rx.test(String(h.location ?? ''))
    || rx.test(String(h.city ?? '')),
  ).slice(0, limit);
}

async function sendWelcome(psid: string, token: string): Promise<void> {
  await sendQuickReplies(
    psid,
    token,
    'Welcome to Madyaw! I can help you find places to stay across the Philippines.\n\nChoose an option below, or type a city or hotel name (e.g. Butuan).',
    [
      { title: 'Search stays', payload: 'MAY_SEARCH' },
      { title: 'Browse website', payload: 'MAY_BROWSE' },
      { title: 'How booking works', payload: 'MAY_HELP' },
    ],
  );
}

async function sendHelp(psid: string, token: string): Promise<void> {
  await sendButtonTemplate(
    psid,
    token,
    'How Madyaw booking works:\n1. Search and pick a hotel on our website\n2. Submit a reservation request with your details and Valid ID\n3. The hotel reviews and confirms by email\n\nOnline payment (half or full) depends on each hotel\'s policy.',
    [
      { type: 'web_url', title: 'Open Madyaw', url: siteUrl('/') },
      { type: 'postback', title: 'Search stays', payload: 'MAY_SEARCH' },
    ],
  );
}

async function sendBrowse(psid: string, token: string): Promise<void> {
  await sendButtonTemplate(
    psid,
    token,
    'Browse all partner stays and complete your booking securely on our website.',
    [
      { type: 'web_url', title: 'Search on website', url: siteUrl('/search') },
      { type: 'postback', title: 'Search here', payload: 'MAY_SEARCH' },
    ],
  );
}

async function promptDestination(psid: string, token: string): Promise<void> {
  setStep(psid, 'awaiting_destination');
  await sendText(
    psid,
    token,
    'Where would you like to stay? Type a city, area, or hotel name (e.g. Butuan, Gloreto).',
  );
}

async function sendSearchResults(psid: string, token: string, query: string): Promise<void> {
  const results = await searchHotels(query, 3);
  setStep(psid, 'idle');

  if (results.length === 0) {
    await sendButtonTemplate(
      psid,
      token,
      `I couldn't find stays matching "${query}". Try another spelling, or search on our website.`,
      [
        { type: 'web_url', title: 'Search website', url: siteUrl(`/search?destination=${encodeURIComponent(query)}`) },
        { type: 'postback', title: 'Try again', payload: 'MAY_SEARCH' },
      ],
    );
    return;
  }

  for (const hotel of results) {
    const id = String(hotel._id);
    const name = String(hotel.name ?? 'Partner stay');
    const location = String(hotel.location ?? hotel.city ?? 'Philippines');
    await sendButtonTemplate(
      psid,
      token,
      `${name}\n${location}`,
      [
        { type: 'web_url', title: 'View & book', url: siteUrl(`/hotels/${id}`) },
        { type: 'postback', title: 'Search again', payload: 'MAY_SEARCH' },
      ],
    );
  }

  await sendText(
    psid,
    token,
    'Tap View & book to open the hotel on madyaw.com, pick dates, and submit your reservation request.',
  );
}

export async function handleMessengerPostback(psid: string, payload: string): Promise<void> {
  const token = getMessengerPageAccessToken();
  if (!token) return;

  switch (payload) {
    case 'MAY_SEARCH':
      await promptDestination(psid, token);
      break;
    case 'MAY_BROWSE':
      await sendBrowse(psid, token);
      break;
    case 'MAY_HELP':
      await sendHelp(psid, token);
      break;
    case 'GET_STARTED':
    default:
      await sendWelcome(psid, token);
      break;
  }
}

export async function handleMessengerText(psid: string, text: string): Promise<void> {
  const token = getMessengerPageAccessToken();
  if (!token) return;

  const normalized = normalizeText(text);
  const session = getSession(psid);

  await typingOn(psid, token);

  if (session.step === 'awaiting_destination' && normalized.length >= 2) {
    await sendSearchResults(psid, token, text.trim());
    return;
  }

  if (isGreeting(normalized)) {
    await sendWelcome(psid, token);
    return;
  }

  if (isSearchIntent(normalized)) {
    await promptDestination(psid, token);
    return;
  }

  if (/^(help|how|policy|payment|cancel)/.test(normalized)) {
    await sendHelp(psid, token);
    return;
  }

  if (normalized.length >= 2) {
    await sendSearchResults(psid, token, text.trim());
    return;
  }

  await sendWelcome(psid, token);
}

export async function handleMessengerEvent(event: {
  sender?: { id?: string };
  message?: { text?: string; is_echo?: boolean; quick_reply?: { payload?: string } };
  postback?: { payload?: string };
}): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) return;

  // Ignore echoes of messages sent by the Page itself.
  if (event.message?.is_echo) return;

  if (event.postback?.payload) {
    console.log('[Messenger] Postback from', psid, event.postback.payload);
    await handleMessengerPostback(psid, event.postback.payload);
    return;
  }

  const quickReplyPayload = event.message?.quick_reply?.payload;
  if (quickReplyPayload) {
    console.log('[Messenger] Quick reply from', psid, quickReplyPayload);
    await handleMessengerPostback(psid, quickReplyPayload);
    return;
  }

  const text = event.message?.text?.trim();
  if (text) {
    console.log('[Messenger] Text from', psid);
    await handleMessengerText(psid, text);
    return;
  }

  console.log('[Messenger] Ignored event from', psid, '(no text/postback)');
}

/** @internal test helper */
export function resetMessengerSessionsForTests(): void {
  sessions.clear();
}
