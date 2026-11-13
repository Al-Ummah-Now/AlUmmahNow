/**
 * Own domains of a white-label site (wiki AUN-SCHOLAR-SITES §4.2, #1212): the state side. admin-api
 * talks to Cloudflare for SaaS and calls these through /internal/sites/:channelId/domains; this side
 * keeps the domain list in the site's settings and the host in the create-only host index, so a
 * domain attached to another site is refused before Cloudflare is asked.
 *
 * A domain joins `hosts` (kind custom, so the sites Worker serves it) only once it is live. Removing
 * the primary domain, or a live domain going back to not live, falls the primary back to the
 * subdomain.
 */
import {
	SITE_DOMAIN_STATUSES,
	checkNewSiteDomain,
	normalizeSiteHost,
	siteSubdomainHost,
	siteTrafficRecord,
	type SiteDnsRecord,
	type SiteDomain,
	type SiteDomainStatus,
	type SiteHost,
	type SiteSettings,
} from '@al-ummah/shared-types';
import { SiteError, claimHost, readSettings, releaseHost, siteEnvironment, writeSettings, type SitesEnv } from './store';

const RECORD_TYPES = new Set(['CNAME', 'TXT']);
const PURPOSES = new Set(['traffic', 'ownership', 'certificate']);

function liveSettings(current: { settings: SiteSettings } | null): SiteSettings {
	if (!current || current.settings.status === 'revoked') throw new SiteError(404, 'site_not_found');
	return current.settings;
}

function bump(s: SiteSettings, actor: string, now: Date): SiteSettings {
	return { ...s, configVersion: s.configVersion + 1, updatedAt: now.toISOString(), updatedBy: actor };
}

/** Hosts after a domain's state changed: live domains are custom hosts; the primary falls back when it went away. */
export function hostsFor(s: SiteSettings, domains: SiteDomain[], env: ReturnType<typeof siteEnvironment>): SiteHost[] {
	const sub = siteSubdomainHost(s.slug, env);
	const live = new Set(domains.filter((d) => d.status === 'live').map((d) => d.host));
	const kept = s.hosts.filter((h) => h.kind !== 'custom' || live.has(h.host));
	for (const host of live) if (!kept.some((h) => h.host === host)) kept.push({ host, kind: 'custom', primary: false });
	if (!kept.some((h) => h.host === sub)) kept.unshift({ host: sub, kind: 'subdomain', primary: false });
	if (!kept.some((h) => h.primary)) return kept.map((h) => ({ ...h, primary: h.host === sub }));
	return kept;
}

/**
 * Reserves a new own domain: checks it, claims it in the host index (409 host_taken when another
 * site holds it) and records it as waiting for DNS. admin-api then creates the Cloudflare hostname.
 */
export async function reserveDomain(env: SitesEnv, channelId: string, rawHost: string, actor: string, now = new Date()): Promise<{ site: SiteSettings; domain: SiteDomain }> {
	const current = await readSettings(env, channelId);
	const s = liveSettings(current);
	const checked = checkNewSiteDomain(rawHost, s, siteEnvironment(env));
	if ('problem' in checked) throw new SiteError(checked.problem === 'domain_limit' ? 403 : checked.problem === 'domain_exists' ? 409 : 400, checked.problem);
	const host = checked.host;
	await claimHost(env, { host, channelId, kind: 'custom', createdAt: now.toISOString() });
	const domain: SiteDomain = { host, cfId: null, status: 'waiting_dns', records: [siteTrafficRecord(host)], addedAt: now.toISOString(), addedBy: actor, checkedAt: null, error: null };
	const after = bump({ ...s, domains: [...(s.domains ?? []), domain] }, actor, now);
	try {
		await writeSettings(env, after, current!.etag);
	} catch (error) {
		await releaseHost(env, host, channelId);
		throw error;
	}
	return { site: after, domain };
}

export interface DomainUpdate {
	cfId?: string | null;
	status?: SiteDomainStatus;
	records?: SiteDnsRecord[];
	error?: string | null;
	checkedAt?: string | null;
}

function cleanRecords(input: unknown): SiteDnsRecord[] {
	if (!Array.isArray(input)) throw new SiteError(400, 'records_invalid');
	return input.slice(0, 8).map((r) => {
		const x = r as Record<string, unknown>;
		const type = String(x.type ?? '');
		const purpose = String(x.purpose ?? '');
		const name = String(x.name ?? '').slice(0, 253);
		const value = String(x.value ?? '').slice(0, 512);
		if (!RECORD_TYPES.has(type) || !PURPOSES.has(purpose) || !name || !value) throw new SiteError(400, 'records_invalid');
		return { type: type as SiteDnsRecord['type'], purpose: purpose as SiteDnsRecord['purpose'], name, value };
	});
}

/** Records what Cloudflare answered (admin-api's create and status checks). */
export async function updateDomain(env: SitesEnv, channelId: string, rawHost: string, update: DomainUpdate, actor: string, now = new Date()): Promise<{ site: SiteSettings; domain: SiteDomain }> {
	const host = normalizeSiteHost(rawHost) ?? '';
	const current = await readSettings(env, channelId);
	const s = liveSettings(current);
	const domains = s.domains ?? [];
	const at = domains.findIndex((d) => d.host === host);
	if (at === -1) throw new SiteError(404, 'domain_not_found');
	if (update.status !== undefined && !SITE_DOMAIN_STATUSES.includes(update.status)) throw new SiteError(400, 'status_invalid');
	const domain: SiteDomain = {
		...domains[at],
		...(update.cfId !== undefined ? { cfId: update.cfId ? String(update.cfId).slice(0, 64) : null } : {}),
		...(update.status !== undefined ? { status: update.status } : {}),
		...(update.records !== undefined ? { records: cleanRecords(update.records) } : {}),
		...(update.error !== undefined ? { error: update.error ? String(update.error).slice(0, 300) : null } : {}),
		checkedAt: update.checkedAt === undefined ? now.toISOString() : update.checkedAt,
	};
	const nextDomains = domains.map((d, i) => (i === at ? domain : d));
	const after = bump({ ...s, domains: nextDomains, hosts: hostsFor(s, nextDomains, siteEnvironment(env)) }, actor, now);
	await writeSettings(env, after, current!.etag);
	return { site: after, domain };
}

/** Removes an own domain: frees the host; the primary falls back to the subdomain when it was this one. */
export async function removeDomain(env: SitesEnv, channelId: string, rawHost: string, actor: string, now = new Date()): Promise<{ site: SiteSettings; removed: SiteDomain }> {
	const host = normalizeSiteHost(rawHost) ?? '';
	const current = await readSettings(env, channelId);
	const s = liveSettings(current);
	const removed = (s.domains ?? []).find((d) => d.host === host);
	if (!removed) throw new SiteError(404, 'domain_not_found');
	const nextDomains = (s.domains ?? []).filter((d) => d.host !== host);
	const after = bump({ ...s, domains: nextDomains, hosts: hostsFor({ ...s, hosts: s.hosts.filter((h) => h.host !== host) }, nextDomains, siteEnvironment(env)) }, actor, now);
	await writeSettings(env, after, current!.etag);
	await releaseHost(env, host, channelId);
	return { site: after, removed };
}

/** Picks the primary host: the subdomain or a live own domain. Every other host redirects to it. */
export async function setPrimaryHost(env: SitesEnv, channelId: string, rawHost: string, actor: string, now = new Date()): Promise<SiteSettings> {
	const host = normalizeSiteHost(rawHost) ?? '';
	const current = await readSettings(env, channelId);
	const s = liveSettings(current);
	const hosts = hostsFor(s, s.domains ?? [], siteEnvironment(env));
	if (!hosts.some((h) => h.host === host)) throw new SiteError(409, 'host_not_live');
	const after = bump({ ...s, hosts: hosts.map((h) => ({ ...h, primary: h.host === host })) }, actor, now);
	await writeSettings(env, after, current!.etag);
	return after;
}
