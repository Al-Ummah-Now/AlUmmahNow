'use client';

/**
 * Live streams, read and changed straight from the browser (api-videos
 * /api/live-streams, PR #867). The same calls serve both live providers
 * (Bunny Stream Live and self-hosted): Studio and the watch page never branch
 * on the provider except to read the ingest protocol's help text.
 */
import type { LiveIngest, LiveProviderId, LiveStreamState } from '@al-ummah/shared-types';
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

/** A refused or failed call; `code` is the API's code (live_capacity, live_budget, …) when it sent one. */
export class LiveApiError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
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
  const body = (await res.json().catch(() => null)) as { result?: T; code?: string } | null;
  if (!res.ok || !body) throw new LiveApiError(res.status, body?.code ?? null);
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

/** The refusal codes Studio explains in its own words; anything else is the generic message. */
export const LIVE_ERROR_CODES = ['live_capacity', 'live_budget', 'live_unavailable', 'live_provider_error'] as const;
export type LiveErrorCode = (typeof LIVE_ERROR_CODES)[number] | 'generic';

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
