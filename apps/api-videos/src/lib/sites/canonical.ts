/**
 * Where the platform's own pages point their canonical for channels with a scholar site
 * (wiki AUN-SCHOLAR-SITES §4.4, SS7, #1215): "the canonical follows the brand host".
 *   - a live site (subdomain or own domain): the channel's community posts are canonical on the site;
 *   - a live site whose primary host is the scholar's own domain: its videos are too.
 *
 * The store never lists or scans (store.ts), so the live sites are kept in one small derived index,
 * `site-canonicals.json` in `channel_tabs`: { channelId: { host, kind, locales } } for live sites only.
 * Every settings write goes through writeSettings, which calls syncSiteCanonical; the host lookup the
 * sites Worker makes every minute repairs an entry that a failed sync left wrong (publicSiteForHost).
 * The sitemaps and GET /api/sites/by-channel/:id read the index (one object, memoised per isolate).
 */
import { primarySiteHost, type PublicSiteLink, type SiteLocale, type SiteSettings } from '@al-ummah/shared-types';
import { logger } from '../logger';
import { CHANNEL_ID, siteEnvironment, type SitesEnv } from './store';

export const SITE_CANONICALS_KEY = 'site-canonicals.json';
const MEMO_MS = 60_000;
const SYNC_ATTEMPTS = 5;

export interface SiteCanonicalEntry {
	host: string;
	kind: 'subdomain' | 'custom';
	locales: SiteLocale[];
}

interface SiteCanonicalIndex {
	version: 1;
	channels: Record<string, SiteCanonicalEntry>;
}

/** Channel ids whose posts / videos are canonical on a site (the sitemaps leave them out). */
export interface SiteCanonicalChannels {
	posts: string[];
	videos: string[];
}

let memo: { at: number; index: SiteCanonicalIndex } | null = null;

/** Tests: forget the memoised index. */
export function resetSiteCanonicalMemo(): void {
	memo = null;
}

/** What a site's settings put in the index: an entry for a live site, nothing otherwise. */
export function canonicalEntryFor(settings: SiteSettings, env: Pick<SitesEnv, 'SITES_ENV'>): SiteCanonicalEntry | null {
	if (settings.status !== 'live') return null;
	const primary = primarySiteHost(settings, siteEnvironment(env));
	return { host: primary.host, kind: primary.kind, locales: [...settings.locales] };
}

const sameEntry = (a: SiteCanonicalEntry | undefined, b: SiteCanonicalEntry | null) =>
	(!a && !b) || (!!a && !!b && a.host === b.host && a.kind === b.kind && a.locales.join(',') === b.locales.join(','));

async function readIndex(env: SitesEnv): Promise<{ index: SiteCanonicalIndex; etag: string | null }> {
	const object = await env.channel_tabs.get(SITE_CANONICALS_KEY);
	if (!object) return { index: { version: 1, channels: {} }, etag: null };
	const index = await object.json<SiteCanonicalIndex>();
	return { index: { version: 1, channels: index?.channels ?? {} }, etag: object.etag };
}

/** The index, memoised for a minute per isolate (a site going live shows within one cache cycle, §4.4). */
export async function siteCanonicalIndex(env: SitesEnv, now = Date.now()): Promise<SiteCanonicalIndex> {
	if (memo && now - memo.at < MEMO_MS) return memo.index;
	const { index } = await readIndex(env);
	memo = { at: now, index };
	return index;
}

/**
 * Puts one site's entry in the index (or takes it out), ETag-guarded so two sites saving at once
 * both land. Returns false when it gave up; the caller's save has already happened, and the next host
 * lookup repairs the entry.
 */
export async function syncSiteCanonical(env: SitesEnv, settings: SiteSettings): Promise<boolean> {
	const want = canonicalEntryFor(settings, env);
	for (let attempt = 1; attempt <= SYNC_ATTEMPTS; attempt++) {
		try {
			const { index, etag } = await readIndex(env);
			if (sameEntry(index.channels[settings.channelId], want)) return true;
			const channels = { ...index.channels };
			if (want) channels[settings.channelId] = want;
			else delete channels[settings.channelId];
			const written = await env.channel_tabs.put(SITE_CANONICALS_KEY, JSON.stringify({ version: 1, channels } satisfies SiteCanonicalIndex), {
				onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
				httpMetadata: { contentType: 'application/json' },
			});
			if (written) {
				memo = null;
				return true;
			}
		} catch (error) {
			logger.warn('[Sites] canonical index sync attempt failed', { channelId: settings.channelId, attempt, error: error instanceof Error ? error.message : String(error) });
		}
	}
	logger.error('[Sites] canonical index sync gave up; the next host lookup repairs it', { channelId: settings.channelId, status: settings.status });
	return false;
}

/** Repairs the index from settings just read (cheap: compares with the memoised copy first). */
export async function repairSiteCanonical(env: SitesEnv, settings: SiteSettings): Promise<void> {
	const index = await siteCanonicalIndex(env);
	if (sameEntry(index.channels[settings.channelId], canonicalEntryFor(settings, env))) return;
	await syncSiteCanonical(env, settings);
}

/** The channels whose posts / videos are canonical on a site. */
export async function siteCanonicalChannels(env: SitesEnv): Promise<SiteCanonicalChannels> {
	const index = await siteCanonicalIndex(env);
	const entries = Object.entries(index.channels);
	return { posts: entries.map(([id]) => id), videos: entries.filter(([, e]) => e.kind === 'custom').map(([id]) => id) };
}

/** `GET /api/sites/by-channel/:id`: the channel's live site, or null (no site, not live, channel suspended or gone). */
export async function publicSiteLink(env: SitesEnv, channelId: string): Promise<PublicSiteLink | null> {
	if (!CHANNEL_ID.test(channelId)) return null;
	const entry = (await siteCanonicalIndex(env)).channels[channelId];
	if (!entry) return null;
	if (env.channels) {
		const object = await env.channels.get(channelId);
		const channel = object ? await object.json<{ isDeleted?: boolean; isSuspended?: boolean }>() : null;
		if (!channel || channel.isDeleted || channel.isSuspended) return null;
	}
	return { channelId, primaryHost: entry.host, primaryKind: entry.kind, locales: entry.locales };
}
