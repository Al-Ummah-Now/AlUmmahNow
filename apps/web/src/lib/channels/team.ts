'use client';

/**
 * The channel Team and Invitations pages' API calls (docs/specs/CHANNEL-ROLES.md §13):
 * members, invitations, the activity log and my own invitations, straight
 * from the browser with the session's token. Failures come back as a `TeamError` with the
 * API's machine code; the page shows friendly copy for it and the failure is
 * reported (never the raw message).
 */

import type { ChannelAuditEntry, ChannelInviteView, ChannelMemberRole, ChannelRole, MyChannelInvite } from '@al-ummah/shared-types';
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
  invites: ChannelInviteView[];
  maxMembers: number;
}

export interface TeamActivityPage {
  entries: ChannelAuditEntry[];
  nextCursor: string | null;
}

/** API codes the page has copy for; anything else shows the generic message. */
export type TeamErrorCode =
  | 'person_not_found'
  | 'already_member'
  | 'cannot_invite_owner'
  | 'member_limit'
  | 'forbidden'
  | 'already_invited'
  | 'pending_limit'
  | 'rate_limited'
  | 'shared_limit'
  | 'invite_not_found'
  | 'invalid_email'
  | 'signed_out'
  | 'unknown';

const KNOWN: ReadonlyArray<TeamErrorCode> = [
  'person_not_found', 'already_member', 'cannot_invite_owner', 'member_limit', 'forbidden',
  'already_invited', 'pending_limit', 'rate_limited', 'shared_limit', 'invite_not_found', 'invalid_email',
];

export class TeamError extends Error {
  constructor(readonly code: TeamErrorCode, readonly status?: number) {
    super(`Channel team request failed (${code}${status ? ` ${status}` : ''})`);
    this.name = 'TeamError';
  }
}

type TeamAction = 'team-load' | 'team-invite' | 'team-invite-cancel' | 'team-update' | 'team-remove' | 'team-activity' | 'invites-load' | 'invite-accept' | 'invite-decline';

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

/** Email when it looks like one, otherwise an @handle (§4.1). */
export function inviteTarget(input: string): { email: string } | { handle: string } {
  const value = input.trim();
  if (!value.startsWith('@') && value.includes('@')) return { email: value };
  return { handle: value.replace(/^@+/, '') };
}

export function inviteToTeam(channelId: string, who: string, role: ChannelMemberRole): Promise<TeamState> {
  return teamRequest<TeamState>('team-invite', `/api/channels/${encodeURIComponent(channelId)}/invites`, { method: 'POST', body: { ...inviteTarget(who), role } });
}

export function cancelTeamInvite(channelId: string, inviteId: string): Promise<TeamState> {
  return teamRequest<TeamState>('team-invite-cancel', `/api/channels/${encodeURIComponent(channelId)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
}

export function loadTeamActivity(channelId: string, cursor?: string | null): Promise<TeamActivityPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return teamRequest<TeamActivityPage>('team-activity', `/api/channels/${encodeURIComponent(channelId)}/audit${query}`, { method: 'GET' });
}

export async function loadMyInvites(): Promise<MyChannelInvite[]> {
  return (await teamRequest<{ invites: MyChannelInvite[] }>('invites-load', '/api/channel-invites', { method: 'GET' })).invites;
}

export function acceptInvite(inviteId: string): Promise<{ channelId: string; role: ChannelMemberRole }> {
  return teamRequest('invite-accept', `/api/channel-invites/${encodeURIComponent(inviteId)}/accept`, { method: 'POST' });
}

export async function declineInvite(inviteId: string): Promise<void> {
  await teamRequest<unknown>('invite-decline', `/api/channel-invites/${encodeURIComponent(inviteId)}/decline`, { method: 'POST' });
}

/** Whole days until `iso` (0 = today), never negative. */
export function daysUntil(iso: string, now = Date.now()): number {
  const ms = new Date(iso).getTime() - now;
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

export function changeTeamRole(channelId: string, userId: string, role: ChannelMemberRole): Promise<TeamState> {
  return teamRequest<TeamState>('team-update', `${base(channelId)}/${encodeURIComponent(userId)}`, { method: 'PUT', body: { role } });
}

export async function removeTeamMember(channelId: string, userId: string): Promise<void> {
  await teamRequest<unknown>('team-remove', `${base(channelId)}/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}
