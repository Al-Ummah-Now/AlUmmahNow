'use server';

/**
 * White-label scholar sites (admin-api /api/sites; wiki AUN-SCHOLAR-SITES §8). admin-api checks
 * creators:manage on every change and audits it; these are thin server actions over it.
 */
import type { AdminAuditEntry, SiteLimits, SiteLocale, SiteSettings, SiteStatus, SiteTier } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { requestAdmin } from './request';

export interface SiteChannel {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export interface SiteListItem {
  channelId: string;
  enabled: boolean;
  grantedBy: string;
  changedAt: string;
  channel: SiteChannel | null;
  site: SiteSettings | null;
}

export interface SiteDetail {
  channel: SiteChannel | null;
  site: SiteSettings | null;
  history: AdminAuditEntry[];
}

async function mutate<T>(endpoint: string, method: string, body?: unknown): Promise<ActionResult<T>> {
  try {
    const res = await requestAdmin(endpoint, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ok: true, data: res.result as T };
  } catch (error) {
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message, code: error.code };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

const enc = encodeURIComponent;

export async function listSites(q = ''): Promise<SiteListItem[]> {
  const res = await requestAdmin(`/api/sites${q ? `?q=${enc(q)}` : ''}`);
  return ((res.result as { sites?: SiteListItem[] })?.sites ?? []) as SiteListItem[];
}

export async function getSite(channelId: string): Promise<ActionResult<SiteDetail>> {
  return mutate(`/api/sites/${enc(channelId)}`, 'GET');
}

export async function checkSiteSlug(slug: string, channelId?: string): Promise<ActionResult<{ available: boolean; reason: string | null; host: string }>> {
  return mutate(`/api/sites/slug/${enc(slug)}${channelId ? `?channelId=${enc(channelId)}` : ''}`, 'GET');
}

export async function grantSite(channelId: string, input: { tier: SiteTier; slug: string; limits: SiteLimits; locales: SiteLocale[] }): Promise<ActionResult<{ site: SiteSettings }>> {
  return mutate(`/api/sites/${enc(channelId)}`, 'POST', input);
}

export async function updateSite(channelId: string, patch: { status?: SiteStatus; tier?: SiteTier; limits?: SiteLimits; slug?: string }): Promise<ActionResult<{ site: SiteSettings }>> {
  return mutate(`/api/sites/${enc(channelId)}`, 'PATCH', patch);
}

export async function revokeSite(channelId: string): Promise<ActionResult<{ site: SiteSettings }>> {
  return mutate(`/api/sites/${enc(channelId)}`, 'DELETE');
}

export async function restoreSite(channelId: string): Promise<ActionResult<{ site: SiteSettings }>> {
  return mutate(`/api/sites/${enc(channelId)}/restore`, 'POST', {});
}
