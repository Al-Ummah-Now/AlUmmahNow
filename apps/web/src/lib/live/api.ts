'use client';

/**
 * Live streams, read and changed straight from the browser (api-videos
 * /api/live-streams, PR #867). The same calls serve both live providers
 * (Bunny Stream Live and self-hosted): Studio and the watch page never branch
 * on the provider except to read the ingest protocol's help text.
 */
import { FEATURE_OFF_CODE, type LiveChatAction, type LiveChatMessage, type LiveEventType, type LiveStreamKind, type LiveIngest, type LiveProviderId, type LiveStreamState } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';

export interface LiveStreamRow {
  id: string;
  title: string;
  description?: string;
  status: LiveStreamState['status'];
  isPrivate?: boolean;
  channelId?: string | null;
  userId?: string;
  dateCreated?: string;
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  provider?: LiveProviderId | null;
  sessionId?: string | null;
  playbackUrl?: string | null;
  vodUrl?: string | null;
  thumbnailUrl?: string | null;
}

export interface LiveStateView extends LiveStreamState {
  provider: LiveProviderId | null;
  qoe: { sampleRate: number };
  /** Server clock (ms) when the state was read; newer servers only. */
  serverNow?: number;
  scheduledStartTime?: string | null;
  /** Live chat for this caller (wiki E17 §5.1); absent on older servers, all off while the feature is off. */
  chat?: LiveChatView;
  canModerate?: boolean;
  /** A live stream unless it says premiere (wiki E17 §5.4) */
  kind?: LiveStreamKind;
  /** The video a premiere shows, once it is on or over */
  premiereVideoId?: string | null;
  durationSeconds?: number | null;
  /** Event tag; null while event tags are off */
  eventType?: LiveEventType | null;
  reminder?: LiveReminderView;
}

/** `enabled`: one can be set (a public stream of a channel that has not started). */
export interface LiveReminderView {
  enabled: boolean;
  count: number;
  set: boolean;
}

export interface LiveChatView {
  enabled: boolean;
  replay: boolean;
  slowModeSeconds: number;
  subscribersOnly: boolean;
  canPost: boolean;
}

/** A state read plus what the player needs to estimate the server clock offset. */
export interface TimedState {
  state: LiveStateView;
  /** Local clock before the request and after the response (ms). */
  sentAt: number;
  receivedAt: number;
  /** The response's Date header, when exposed (second resolution). */
  dateHeader: string | null;
}

export interface IngestView {
  ingest: LiveIngest | null;
  state: LiveStreamState;
}

/** A refused or failed call; `code` is the API's code (live_capacity, feature_off, …) when it sent one. */
export class LiveApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, readonly retryAfter: number | null = null) {
    super(`Live request failed (${status}${code ? ` ${code}` : ''})`);
    this.name = 'LiveApiError';
  }
}

type Auth = 'required' | 'optional';

async function request(path: string, init: RequestInit & { auth: Auth; channelId?: string }): Promise<Response> {
  const { auth, channelId, ...rest } = init;
  const send = async (force: boolean) => {
    const { accessToken } = await fetchClientAuthInfo(force);
    if (!accessToken && auth === 'required') throw new LiveApiError(401, null);
    const headers: Record<string, string> = { ...((rest.headers as Record<string, string>) ?? {}) };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (channelId) headers.channelId = channelId;
    return fetch(`${getApiUrl().replace(/\/$/, '')}${path}`, { ...rest, headers, cache: 'no-store' });
  };
  let res = await send(false);
  // The cached token expired between the two calls: one retry with a fresh one
  if (res.status === 401) res = await send(true);
  return res;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as { result?: T; code?: string; retryAfter?: number } | null;
  if (!res.ok || !body) throw new LiveApiError(res.status, body?.code ?? null, typeof body?.retryAfter === 'number' ? body.retryAfter : null);
  return body.result as T;
}

const streamPath = (id: string) => `/api/live-streams/${encodeURIComponent(id)}`;

export interface LivePage {
  items: LiveStreamRow[];
  cursor: string | null;
}

export async function listChannelStreams(channelId: string, cursor?: string | null, signal?: AbortSignal): Promise<LivePage> {
  const q = new URLSearchParams({ channelId, limit: '30' });
  if (cursor) q.set('cursor', cursor);
  const result = await json<{ data: LiveStreamRow[]; cursor?: string }>(await request(`/api/live-streams?${q}`, { auth: 'required', signal }));
  return { items: result.data ?? [], cursor: result.cursor || null };
}

export async function createStream(channelId: string, input: { title: string; description?: string; isPrivate: boolean }): Promise<LiveStreamRow> {
  const res = await request('/api/live-streams', {
    auth: 'required',
    channelId,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: input.title, ...(input.description ? { description: input.description } : {}), isPrivate: input.isPrivate }),
  });
  return (await json<{ stream: LiveStreamRow }>(res)).stream;
}

export async function getStream(id: string, signal?: AbortSignal): Promise<LiveStreamRow> {
  return (await json<{ stream: LiveStreamRow }>(await request(streamPath(id), { auth: 'optional', signal }))).stream;
}

export async function getState(id: string, signal?: AbortSignal): Promise<TimedState> {
  const sentAt = Date.now();
  const res = await request(`${streamPath(id)}/state`, { auth: 'optional', signal });
  const receivedAt = Date.now();
  const state = await json<LiveStateView>(res);
  return { state, sentAt, receivedAt, dateHeader: res.headers.get('date') };
}

export async function getIngest(id: string, signal?: AbortSignal): Promise<IngestView> {
  return json<IngestView>(await request(`${streamPath(id)}/ingest`, { auth: 'required', signal }));
}

export async function startStream(id: string): Promise<IngestView> {
  return json<IngestView>(await request(`${streamPath(id)}/start`, { auth: 'required', method: 'POST' }));
}

export async function endStream(id: string): Promise<{ state: LiveStreamState }> {
  return json<{ state: LiveStreamState }>(await request(`${streamPath(id)}/end`, { auth: 'required', method: 'POST' }));
}

export async function deleteStream(id: string): Promise<void> {
  await json<{ deleted: boolean }>(await request(streamPath(id), { auth: 'required', method: 'DELETE' }));
}

export async function setReminder(id: string, on: boolean): Promise<{ set: boolean; count: number }> {
  return json<{ set: boolean; count: number }>(await request(`${streamPath(id)}/reminders`, { auth: 'required', method: on ? 'POST' : 'DELETE' }));
}

/** The refusal codes Studio explains in its own words; anything else is the generic message. */
export const LIVE_ERROR_CODES = ['live_capacity', 'live_provider_error', 'live_hours_used', 'live_concurrent_limit'] as const;
/** Quota refusals by the channel owner's creator tier (402/403), not failures: never reported as errors. */
export const LIVE_TIER_CODES: readonly string[] = ['live_hours_used', 'live_concurrent_limit'];
export type LiveErrorCode = (typeof LIVE_ERROR_CODES)[number] | 'generic';

/**
 * Live is off for this channel (404 feature_off: not in the owner's tier, or no provider can take
 * a stream). Studio hides Live then, so the page re-renders and the server answers not found.
 */
export function isLiveOff(error: unknown): boolean {
  return error instanceof LiveApiError && error.status === 404 && error.code === FEATURE_OFF_CODE;
}

export function liveErrorCode(error: unknown): LiveErrorCode {
  const code = error instanceof LiveApiError ? error.code : null;
  return (LIVE_ERROR_CODES as readonly string[]).includes(code ?? '') ? (code as LiveErrorCode) : 'generic';
}

export interface LiveChannelView {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  handle?: string | null;
  avatarUrl?: string | null;
}

/** The stream's channel for the watch page header (public fields). */
export async function getPublicChannel(id: string, signal?: AbortSignal): Promise<LiveChannelView | null> {
  const res = await request(`/api/channels/${encodeURIComponent(id)}`, { auth: 'optional', signal });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as (LiveChannelView & { result?: LiveChannelView }) | null;
  const channel = body?.result ?? body;
  return channel?.id ? channel : null;
}

/**
 * The watch page's heartbeat (AlUmmahNow#30): who is watching now, or null when the count is
 * unavailable. No sign-in and no user data: `viewerId` is a random id kept for the tab.
 */
export async function beatViewer(id: string, viewerId: string, signal?: AbortSignal): Promise<number | null> {
  const res = await fetch(`${getApiUrl().replace(/\/$/, '')}/api/live-streams/${encodeURIComponent(id)}/viewers`, {
    method: 'POST',
    // text/plain: a simple request, no CORS preflight
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ viewerId }),
    cache: 'no-store',
    signal,
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { result?: { viewers?: unknown } } | null;
  return typeof body?.result?.viewers === 'number' ? body.result.viewers : null;
}

/** The tab is leaving the stream: counted out at once instead of after the time to live. Never holds the page. */
export function leaveViewer(id: string, viewerId: string): void {
  const url = `${getApiUrl().replace(/\/$/, '')}/api/live-streams/${encodeURIComponent(id)}/viewers`;
  const body = JSON.stringify({ viewerId, leaving: true });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
  } catch {
    // fall through to a keepalive fetch
  }
  void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Live chat (wiki E17 §5.2)
// ---------------------------------------------------------------------------

export interface ChatPage {
  messages: LiveChatMessage[];
  pinned: LiveChatMessage | null;
  hasMore: boolean;
  truncated?: boolean;
}

export const CHAT_PAGE = 100;

/** The latest messages; with `before`, those before it; with `fromMs`, the replay window. */
export async function readChat(streamId: string, query: { before?: string; fromMs?: number; toMs?: number; limit?: number } = {}, signal?: AbortSignal): Promise<ChatPage> {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) q.set(key, String(value));
  const suffix = q.size ? `?${q}` : '';
  return json<ChatPage>(await request(`${streamPath(streamId)}/chat${suffix}`, { auth: 'optional', signal }));
}

/** `channelId`: post as this channel. `humanToken`: the Turnstile token of an account's first message. */
export async function postChat(streamId: string, text: string, opts: { channelId?: string | null; humanToken?: string } = {}): Promise<LiveChatMessage> {
  const res = await request(`${streamPath(streamId)}/chat`, {
    auth: 'required',
    method: 'POST',
    ...(opts.channelId ? { channelId: opts.channelId } : {}),
    headers: { 'Content-Type': 'application/json', ...(opts.humanToken ? { 'X-Turnstile-Token': opts.humanToken } : {}) },
    body: JSON.stringify({ text }),
  });
  return (await json<{ message: LiveChatMessage }>(res)).message;
}

export async function moderateChat(streamId: string, messageId: string, action: LiveChatAction): Promise<void> {
  await json(
    await request(`${streamPath(streamId)}/chat/${encodeURIComponent(messageId)}/moderate`, {
      auth: 'required',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
  );
}
