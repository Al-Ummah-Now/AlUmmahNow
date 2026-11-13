/**
 * Release smoke for apps/short-links (wiki AUN-SHORT-LINKS), run right after its `wrangler deploy` in
 * release.yml (and by hand against QA):
 *
 *   node --experimental-strip-types scripts/release/short-links-smoke.ts --env qa|stage|production
 *
 *   - robots.txt refuses search crawlers (the real pages are the ones to index)
 *   - an unknown id answers 404 with X-Robots-Tag noindex (the Worker owns the host)
 *   - the root redirects to the www home
 *   - a public video's short link redirects (301) to its watch page, ?lang=ar to the Arabic one,
 *     with ?t= kept (the video is the newest public one of the public API; read only)
 * Exits 1 with every failure listed; the workflow then rolls the short-links Worker back.
 *
 * A custom domain attached by this very deploy (the first release of an env) needs a few minutes
 * before its DNS and certificate serve: v2026.11.13.6's stage smoke failed with `fetch failed`
 * while stage.alummahnow.link was still coming up. So the run first waits up to ~3 min for the host
 * to answer at all (as status-smoke.ts does since #1229). If it never does, nothing is checked and
 * the run ends with a warning (exit 0): the Worker is deployed and the domain is Cloudflare's to
 * bring up. Any HTTP answer that is wrong still fails.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { waitForHost, type SmokeDeps } from './status-smoke.ts';

export type ShortLinksEnv = 'qa' | 'stage' | 'production';

export const SHORT_LINK_HOSTS: Record<ShortLinksEnv, { short: string; site: string; www: string; api: string }> = {
	production: { short: 'https://alummahnow.link', site: 'https://videos.alummahnow.net', www: 'https://www.alummahnow.net', api: 'https://videos.api.alummahnow.net' },
	stage: { short: 'https://stage.alummahnow.link', site: 'https://videos.stage.alummahnow.net', www: 'https://www.stage.alummahnow.net', api: 'https://videos.api.stage.alummahnow.net' },
	qa: { short: 'https://qa.alummahnow.link', site: 'https://videos.qa.alummahnow.net', www: 'https://www.qa.alummahnow.net', api: 'https://videos.api.qa.alummahnow.net' },
};

export const SHORT_LINK_WORKERS: Record<ShortLinksEnv, string> = {
	production: 'al-ummah-now-short-links',
	stage: 'al-ummah-now-short-links-stage',
	qa: 'al-ummah-now-short-links-qa',
};

export interface SmokeResult {
	name: string;
	ok: boolean;
	detail: string;
}

const UA = { 'User-Agent': 'al-ummah-release-smoke' };

export async function shortLinksSmoke(env: ShortLinksEnv, deps: { fetch: typeof fetch }): Promise<SmokeResult[]> {
	const h = SHORT_LINK_HOSTS[env];
	const out: SmokeResult[] = [];
	const check = async (name: string, fn: () => Promise<string>) => {
		try {
			out.push({ name, ok: true, detail: await fn() });
		} catch (error) {
			out.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
		}
	};
	const get = (path: string) => deps.fetch(`${h.short}${path}`, { redirect: 'manual', headers: UA });

	await check('robots.txt refuses search crawlers', async () => {
		const res = await get('/robots.txt');
		const text = await res.text();
		if (res.status !== 200 || !/User-agent: \*\nDisallow: \//.test(text)) throw new Error(`got ${res.status}`);
		return '200';
	});
	await check('unknown id → 404, noindex', async () => {
		const res = await get('/v/00000000-0000-4000-8000-000000000000');
		if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
		if (!/noindex/.test(res.headers.get('x-robots-tag') ?? '')) throw new Error('no X-Robots-Tag noindex');
		return '404 noindex';
	});
	await check('root → www home', async () => {
		const res = await get('/');
		const location = res.headers.get('location') ?? '';
		if (res.status !== 301 || location !== `${h.www}/`) throw new Error(`expected 301 to ${h.www}/, got ${res.status} ${location}`);
		return location;
	});
	await check('a public video redirects to its watch page (en default, ar, t kept)', async () => {
		const list = await deps.fetch(`${h.api}/api/videos?limit=1`, { headers: UA });
		const body = (await list.json().catch(() => ({}))) as { data?: { id?: string }[] };
		const id = body.data?.[0]?.id;
		if (!id) return 'skipped: no public video';
		const plain = await get(`/v/${id}`);
		const plainLocation = plain.headers.get('location') ?? '';
		if (plain.status !== 301 || !plainLocation.startsWith(`${h.site}/`) || !plainLocation.includes(id)) {
			throw new Error(`expected 301 to ${h.site}/…/${id}, got ${plain.status} ${plainLocation}`);
		}
		const ar = await get(`/v/${id}?lang=ar&t=3`);
		const arLocation = ar.headers.get('location') ?? '';
		if (ar.status !== 301 || !arLocation.startsWith(`${h.site}/ar/`) || !arLocation.includes('t=3')) {
			throw new Error(`expected 301 to ${h.site}/ar/…?t=3, got ${ar.status} ${arLocation}`);
		}
		return `${plainLocation}; ${arLocation}`;
	});
	return out;
}

export interface ShortLinksReport {
	/** The host never answered (DNS / certificate of a new custom domain not live yet): nothing was checked */
	unreachable: boolean;
	results: SmokeResult[];
}

/** Waits for a newly attached host to answer at all, then runs the checks. */
export async function shortLinksReport(env: ShortLinksEnv, deps: Pick<SmokeDeps, 'fetch' | 'sleep' | 'reachAttempts'>): Promise<ShortLinksReport> {
	const base = SHORT_LINK_HOSTS[env].short;
	const reach = await waitForHost(`${base}/robots.txt`, deps as SmokeDeps);
	if (!reach.reached) return { unreachable: true, results: [{ name: `${base} answers`, ok: false, detail: reach.last }] };
	return { unreachable: false, results: await shortLinksSmoke(env, { fetch: deps.fetch }) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const i = process.argv.indexOf('--env');
	const env = (i >= 0 ? process.argv[i + 1] : '') as ShortLinksEnv;
	if (!(env in SHORT_LINK_HOSTS)) {
		process.stderr.write('usage: short-links-smoke.ts --env qa|stage|production\n');
		process.exit(2);
	}
	shortLinksReport(env, { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }).then(({ unreachable, results }) => {
		if (unreachable) {
			console.log(`::warning::short links smoke (${env}) skipped: ${SHORT_LINK_HOSTS[env].short} did not answer in ~3 min (${results[0].detail}); a newly attached custom domain can take longer. The Worker is deployed.`);
			return;
		}
		for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
		if (results.some((r) => !r.ok)) {
			console.error(`::error::short links smoke (${env}) failed`);
			process.exit(1);
		}
	});
}
