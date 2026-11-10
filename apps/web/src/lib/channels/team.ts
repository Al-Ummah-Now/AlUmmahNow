'use client';

/**
 * The channel Team page's API calls (GET/POST /api/channels/:id/members,
 * PUT/DELETE /api/channels/:id/members/:userId), straight from the browser
 * with the session's token. Failures come back as a `TeamError` with the
 * API's machine code; the page shows friendly copy for it and the failure is
 * reported (never the raw message).
 */

import type { ChannelMemberRole, ChannelRole } from '@al-ummah/shared-types';
import { getApiUrl } from '@/lib/runtime-config';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { reportChannelListFailure } from './report';

export interface TeamMember {
  userId: string;
  role: ChannelRole;
  displayName?: string;
  avatarUrl?: string;
  addedAt?: string;
  isYou: boolean;
}

export interface TeamState {
  members: TeamMember[];
  maxMembers: number;
}

/** API codes the page has copy for; anything else shows the generic message. */
export type TeamErrorCode =
  | 'person_not_found'
  | 'already_member'
  | 'cannot_invite_owner'
  | 'member_limit'
  | 'forbidden'
  | 'signed_out'
  | 'unknown';

const KNOWN: ReadonlyArray<TeamErrorCode> = ['person_not_found', 'already_member', 'cannot_invite_owner', 'member_limit', 'forbidden'];

export class TeamError extends Error {
  constructor(readonly code: TeamErrorCode, readonly status?: number) {
    super(`Channel team request failed (${code}${status ? ` ${status}` : ''})`);
    this.name = 'TeamError';
  }
}

type TeamAction = 'team-load' | 'team-add' | 'team-update' | 'team-remove';

async function teamRequest<T>(action: TeamAction, path: string, init: { method: string; body?: unknown }): Promise<T> {
  const url = `${getApiUrl().replace(/\/$/, '')}${path}`;
  const send = (token: string) => fetch(url, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });

  const auth = await fetchClientAuthInfo();
  if (!auth.accessToken) throw new TeamError('signed_out');
  let response: Response;
  try {
    response = await send(auth.accessToken);
    if (response.status === 401) {
      const fresh = await fetchClientAuthInfo(true);
      if (fresh.accessToken && fresh.accessToken !== auth.accessToken) response = await send(fresh.accessToken);
    }
  } catch {
    reportChannelListFailure({ reason: 'network', action });
    throw new TeamError('unknown');
  }

  const body = (await response.json().catch(() => null)) as { success?: boolean; code?: string; data?: T } | null;
  if (!response.ok || body?.success === false) {
    const code = KNOWN.find((k) => k === body?.code) ?? (response.status === 401 ? 'signed_out' : 'unknown');
    // Expected answers (a handle that doesn't exist, a full team) are not failures worth flagging
    if (code === 'unknown' || code === 'forbidden') {
      reportChannelListFailure({ reason: 'http', status: response.status, action, ...(body?.code ? { code: body.code } : {}) });
    }
    throw new TeamError(code, response.status);
  }
  return (body?.data ?? (undefined as T));
}

const base = (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/members`;

export function loadTeam(channelId: string): Promise<TeamState> {
  return teamRequest<TeamState>('team-load', base(channelId), { method: 'GET' });
}

export function addTeamMember(channelId: string, handle: string, role: ChannelMemberRole): Promise<TeamState> {
  return teamRequest<TeamState>('team-add', base(channelId), { method: 'POST', body: { handle: handle.trim().replace(/^@+/, ''), role } });
}

export function changeTeamRole(channelId: string, userId: string, role: ChannelMemberRole): Promise<TeamState> {
  return teamRequest<TeamState>('team-update', `${base(channelId)}/${encodeURIComponent(userId)}`, { method: 'PUT', body: { role } });
}

export async function removeTeamMember(channelId: string, userId: string): Promise<void> {
  await teamRequest<unknown>('team-remove', `${base(channelId)}/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}
