'use server';

/**
 * Invite creators (admin-api /api/invites, docs/admin/INVITES.md). The account
 * exists as soon as the invite is made; auth gets it through admin-api's queue.
 */
import { AdminApiError, type ActionResult } from './errors';
import { requestAdmin } from './request';
import type { InviteListStatus, InviteLookup, InviteView, NewInviteInput } from './invite-types';

async function fetchAdmin<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const body = await requestAdmin(endpoint, options);
  return body.result as T;
}

async function mutate<T>(endpoint: string, method: string, body?: unknown): Promise<ActionResult<T>> {
  try {
    const data = await fetchAdmin<T>(endpoint, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message, code: error.code };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

const enc = encodeURIComponent;

export async function listInvites(params: { status?: InviteListStatus; q?: string; cursor?: string } = {}): Promise<{ items: InviteView[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.q) query.set('q', params.q);
  if (params.cursor) query.set('cursor', params.cursor);
  return fetchAdmin(`/api/invites?${query}`);
}

/** Who already has this email: an account (assign to them instead) or an open invite. */
export async function lookupInviteEmail(email: string): Promise<ActionResult<InviteLookup>> {
  return mutate(`/api/invites/lookup?email=${enc(email)}`, 'GET');
}

export async function createInvite(input: NewInviteInput): Promise<ActionResult<{ invite: InviteView; warnings: Array<{ step: string; code: string; message: string }> }>> {
  return mutate('/api/invites', 'POST', input);
}

/** locale: the language of the email, picked next to Resend. */
export async function resendInvite(id: string, locale?: 'en' | 'ar'): Promise<ActionResult<InviteView>> {
  return mutate(`/api/invites/${enc(id)}/resend`, 'POST', locale ? { locale } : {});
}

/** A new single-use link, shown once (its hash goes to auth). */
export async function copyInviteLink(id: string): Promise<ActionResult<{ invite: InviteView; url: string }>> {
  return mutate(`/api/invites/${enc(id)}/link`, 'POST', {});
}

export async function revokeInvite(id: string, reason: string): Promise<ActionResult<InviteView>> {
  return mutate(`/api/invites/${enc(id)}/revoke`, 'POST', { reason });
}

export async function restoreInvite(id: string): Promise<ActionResult<InviteView>> {
  return mutate(`/api/invites/${enc(id)}/restore`, 'POST', {});
}

export async function purgeInvite(id: string, confirm: string): Promise<ActionResult<InviteView>> {
  return mutate(`/api/invites/${enc(id)}/purge`, 'POST', { confirm });
}

export async function retryInvite(id: string): Promise<ActionResult<InviteView>> {
  return mutate(`/api/invites/${enc(id)}/retry`, 'POST', {});
}
