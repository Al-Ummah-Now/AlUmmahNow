'use client';

/**
 * Channel moves by owners (wiki AUN-CHANNEL-CLAIM §5): offers, and the answers to them, straight from
 * the browser with the session's token. A refusal comes back as a `MoveApiError` whose message is the
 * error catalogue's, in the page's language.
 */
import { API_ERROR_CATALOGUE, apiErrorMessage } from '@al-ummah/shared-types';
import { getApiUrl } from '@/lib/runtime-config';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { reportChannelListFailure } from './report';

export type MoveOfferStatus = 'offered' | 'accepting' | 'moved' | 'declined' | 'cancelled' | 'expired' | 'stopped' | 'refused';

export interface MovePerson {
  name: string | null;
  nameLocalized?: Record<string, string>;
  avatarUrl: string | null;
}

export interface MoveOffer {
  id: string;
  status: MoveOfferStatus;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  keepContactEmail: boolean;
  channel: { id: string; name: string | null; nameLocalized?: Record<string, string>; handle: string | null; avatarUrl: string | null };
  from: MovePerson;
  to: MovePerson;
  viewerRole: 'from' | 'to' | 'owner';
}

export interface MoveReceiver {
  userId: string;
  name: string | null;
  nameLocalized?: Record<string, string>;
  avatarUrl: string | null;
}

export interface ChannelMoveState {
  offer: MoveOffer | null;
  /** From when the owner may move the channel again; null: now */
  movableAt: string | null;
}

export class MoveApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(`Channel move request failed (${code} ${status})`);
    this.name = 'MoveApiError';
  }
}

/** A refusal in the page's words: the catalogue's text for its code, else the generic one. */
export function moveErrorMessage(error: unknown, lang: 'en' | 'ar'): string {
  const code = error instanceof MoveApiError && error.code in API_ERROR_CATALOGUE ? error.code : 'server_error';
  return apiErrorMessage(code, error instanceof MoveApiError ? error.status : 500, lang);
}

/** A failed read: the refusal's own reason, else `generic` (nothing the person did; Retry may help). */
export function loadFailedText(error: unknown, lang: 'en' | 'ar', generic: string): string {
  const known = error instanceof MoveApiError && error.status >= 400 && error.status < 500 && error.code in API_ERROR_CATALOGUE;
  return known ? moveErrorMessage(error, lang) : generic;
}

export const isMoveError = (error: unknown, ...codes: string[]): boolean => error instanceof MoveApiError && codes.includes(error.code);

async function moveRequest<T>(action: string, path: string, init: { method: string; body?: unknown; signal?: AbortSignal } = { method: 'GET' }): Promise<T> {
  const url = `${getApiUrl().replace(/\/$/, '')}${path}`;
  const send = (token: string) =>
    fetch(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: init.signal,
    });
  const auth = await fetchClientAuthInfo();
  if (!auth.accessToken) throw new MoveApiError('authentication_required', 401);
  let response: Response;
  try {
    response = await send(auth.accessToken);
    if (response.status === 401) {
      const fresh = await fetchClientAuthInfo(true);
      if (fresh.accessToken && fresh.accessToken !== auth.accessToken) response = await send(fresh.accessToken);
    }
  } catch (error) {
    if (init.signal?.aborted) throw error;
    reportChannelListFailure({ reason: 'network', action });
    throw new MoveApiError('service_unavailable', 503);
  }
  const body = (await response.json().catch(() => null)) as { success?: boolean; code?: string; data?: T } | null;
  if (!response.ok || body?.success === false) {
    const code = typeof body?.code === 'string' ? body.code : 'server_error';
    // A refusal is an answer; only what the page can't explain is a failure worth flagging
    if (response.status >= 500 || !(code in API_ERROR_CATALOGUE)) reportChannelListFailure({ reason: 'http', status: response.status, action, code });
    throw new MoveApiError(code, response.status);
  }
  return body?.data as T;
}

const channelPath = (id: string) => `/api/channels/${encodeURIComponent(id)}`;
const offerPath = (id: string) => `/api/move-offers/${encodeURIComponent(id)}`;

export const loadMoveState = (channelId: string) => moveRequest<ChannelMoveState>('move-state', `${channelPath(channelId)}/move-offers`);

export async function searchMoveReceivers(channelId: string, q: string, signal?: AbortSignal): Promise<MoveReceiver[]> {
  return (await moveRequest<{ items: MoveReceiver[] }>('move-receivers', `${channelPath(channelId)}/move-receivers${q.trim() ? `?q=${encodeURIComponent(q)}` : ''}`, { method: 'GET', signal })).items;
}

export async function makeMoveOffer(channelId: string, input: { toUserId: string; confirm: string; keepContactEmail: boolean }): Promise<void> {
  await moveRequest<unknown>('move-offer', `${channelPath(channelId)}/move-offers`, { method: 'POST', body: input });
}

export const loadMoveOffer = (id: string) => moveRequest<MoveOffer>('move-offer-load', offerPath(id));

export type MoveSide = 'received' | 'sent';
export interface MyMoveOffers {
  received: MoveOffer[];
  sent: MoveOffer[];
  /** Next page of each side; null: no more */
  receivedCursor: string | null;
  sentCursor: string | null;
}
/** The first page of both sides, or one side's page after its cursor. */
export const loadMyMoveOffers = (more?: { side: MoveSide; cursor: string }) =>
  moveRequest<MyMoveOffers>('move-offers-load', `/api/move-offers${more ? `?${new URLSearchParams(more)}` : ''}`);

export async function acceptMove(id: string): Promise<void> {
  await moveRequest<unknown>('move-accept', `${offerPath(id)}/accept`, { method: 'POST' });
}

export async function declineMove(id: string): Promise<void> {
  await moveRequest<unknown>('move-decline', `${offerPath(id)}/decline`, { method: 'POST' });
}

export async function withdrawMove(id: string): Promise<void> {
  await moveRequest<unknown>('move-withdraw', offerPath(id), { method: 'DELETE' });
}

/** The sign-in must be this recent when the owner opens Move channel; the API wants 10 minutes when the offer is sent. */
export const FRESH_SIGN_IN_SECONDS = 5 * 60;

export function isFreshSignIn(authTime: number | null, now = Date.now()): boolean {
  return authTime !== null && now / 1000 - authTime <= FRESH_SIGN_IN_SECONDS;
}

/** A name inside a sentence: isolated, so either script keeps its own order and punctuation in the other. */
export const isolate = (name: string): string => `⁨${name}⁩`;

export function moveName(named: { name: string | null; nameLocalized?: Record<string, string> }, lang: string, fallback: string): string {
  return named.nameLocalized?.[lang]?.trim() || named.name?.trim() || fallback;
}
