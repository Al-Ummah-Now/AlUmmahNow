/**
 * Own domains of white-label sites (wiki AUN-SCHOLAR-SITES §4.2, #1212), the admin-api side:
 * Cloudflare for SaaS (lib/sites/saas.ts) plus the state in api-videos (/internal/sites/:channelId/
 * domains, which also refuses a host another site holds). Used by the admin Scholar sites screen
 * and, for channel owners and admins, by Studio → Site → Domains (/internal/site-domains).
 *
 * Add: reserve in api-videos → create the Cloudflare hostname → record its records and status.
 * If Cloudflare refuses (for example SaaS is not enabled yet: 1404), the reservation is undone.
 */
import { nextDomainCheck, type SiteDomain, type SiteSettings } from '@al-ummah/shared-types';
import { callSites } from '../../routers/sites.router';
import type { VideosClientEnv } from '../content/videosClient';
import { logger } from '../logger';
import { SaasError, createHostname, deleteHostname, errorOf, getHostname, recordsOf, statusOf, type Fetch, type SaasEnv } from './saas';

export interface DomainsDb {
  prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results?: T[] }>; first<T>(): Promise<T | null> } };
}

export type DomainsEnv = VideosClientEnv & SaasEnv & { REPORTS_DB: DomainsDb };

interface DomainAnswer {
  site: SiteSettings;
  domain: SiteDomain;
}

async function schedule(db: DomainsDb, channelId: string, d: SiteDomain, now: number) {
  await db
    .prepare(
      `INSERT INTO site_domain_checks (host, channel_id, cf_id, added_at, next_check_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(host) DO UPDATE SET channel_id = excluded.channel_id, cf_id = excluded.cf_id, next_check_at = excluded.next_check_at`,
    )
    .bind(d.host, channelId, d.cfId, d.addedAt, nextDomainCheck(d.addedAt, now))
    .run();
}

/** Adds an own domain. Throws SaasError (saas_unavailable while Cloudflare for SaaS is off) or the api-videos error. */
export async function addDomain(env: DomainsEnv, channelId: string, host: string, actor: string, fetchImpl: Fetch = fetch, now = Date.now()): Promise<DomainAnswer> {
  const reserved = await callSites<DomainAnswer>(env, 'POST', `/${channelId}/domains`, actor, { host });
  const h = reserved.domain.host;
  let cf;
  try {
    cf = await createHostname(env, h, fetchImpl);
  } catch (error) {
    await callSites(env, 'DELETE', `/${channelId}/domains/${encodeURIComponent(h)}`, actor).catch((undo) => logger.error('[SiteDomains] undo reserve failed', { channelId, host: h, error: String(undo) }));
    throw error;
  }
  const answer = await callSites<DomainAnswer>(env, 'PATCH', `/${channelId}/domains/${encodeURIComponent(h)}`, actor, {
    cfId: cf.id,
    status: statusOf(cf),
    records: recordsOf(cf),
    error: errorOf(cf),
  });
  await schedule(env.REPORTS_DB, channelId, answer.domain, now);
  logger.info('[SiteDomains] added', { channelId, host: h, status: answer.domain.status });
  return answer;
}

/** Asks Cloudflare for the domain's state now and records it. */
export async function refreshDomain(env: DomainsEnv, channelId: string, domain: SiteDomain, actor: string, fetchImpl: Fetch = fetch, now = Date.now()): Promise<DomainAnswer> {
  if (!domain.cfId) {
    // Creating it at Cloudflare failed half way: try again
    const cf = await createHostname(env, domain.host, fetchImpl);
    const answer = await callSites<DomainAnswer>(env, 'PATCH', `/${channelId}/domains/${encodeURIComponent(domain.host)}`, actor, { cfId: cf.id, status: statusOf(cf), records: recordsOf(cf), error: errorOf(cf) });
    await schedule(env.REPORTS_DB, channelId, answer.domain, now);
    return answer;
  }
  const cf = await getHostname(env, domain.cfId, fetchImpl);
  const answer = await callSites<DomainAnswer>(env, 'PATCH', `/${channelId}/domains/${encodeURIComponent(domain.host)}`, actor, { status: statusOf(cf), records: recordsOf(cf), error: errorOf(cf) });
  await schedule(env.REPORTS_DB, channelId, answer.domain, now);
  return answer;
}

export async function removeDomain(env: DomainsEnv, channelId: string, domain: SiteDomain, actor: string, fetchImpl: Fetch = fetch): Promise<SiteSettings> {
  if (domain.cfId) await deleteHostname(env, domain.cfId, fetchImpl);
  const { site } = await callSites<{ site: SiteSettings }>(env, 'DELETE', `/${channelId}/domains/${encodeURIComponent(domain.host)}`, actor);
  await env.REPORTS_DB.prepare('DELETE FROM site_domain_checks WHERE host = ?').bind(domain.host).run();
  return site;
}

export async function setPrimary(env: DomainsEnv, channelId: string, host: string, actor: string): Promise<SiteSettings> {
  return (await callSites<{ site: SiteSettings }>(env, 'PUT', `/${channelId}/primary`, actor, { host })).site;
}

export async function readSite(env: DomainsEnv, channelId: string): Promise<SiteSettings> {
  return (await callSites<{ site: SiteSettings }>(env, 'GET', `/${channelId}`, 'admin-api')).site;
}

export function findDomain(site: SiteSettings, host: string): SiteDomain | null {
  return (site.domains ?? []).find((d) => d.host === host.toLowerCase()) ?? null;
}

/** The cron: domains whose check is due (indexed, at most `limit`), one Cloudflare read each. */
export async function runDomainChecks(env: DomainsEnv, now = Date.now(), limit = 25, fetchImpl: Fetch = fetch): Promise<{ checked: number; failed: number }> {
  const { results = [] } = await env.REPORTS_DB.prepare('SELECT host, channel_id FROM site_domain_checks WHERE next_check_at <= ? ORDER BY next_check_at LIMIT ?')
    .bind(now, limit)
    .all<{ host: string; channel_id: string }>();
  let checked = 0;
  let failed = 0;
  for (const row of results) {
    try {
      const site = await readSite(env, row.channel_id).catch(() => null);
      const domain = site ? findDomain(site, row.host) : null;
      if (!domain) {
        // The site or the domain is gone: stop checking
        await env.REPORTS_DB.prepare('DELETE FROM site_domain_checks WHERE host = ?').bind(row.host).run();
        continue;
      }
      await refreshDomain(env, row.channel_id, domain, 'domain-check', fetchImpl, now);
      checked++;
    } catch (error) {
      failed++;
      // Try again at the next slot instead of every tick
      await env.REPORTS_DB.prepare('UPDATE site_domain_checks SET next_check_at = ? WHERE host = ?').bind(now + 10 * 60 * 1000, row.host).run().catch(() => undefined);
      if (!(error instanceof SaasError && error.code === 'saas_unavailable')) logger.warn('[SiteDomains] check failed', { host: row.host, channelId: row.channel_id, error: String(error) });
    }
  }
  if (results.length) logger.info('[SiteDomains] checks', { due: results.length, checked, failed });
  return { checked, failed };
}
