/**
 * Release smoke checks (docs/release-pipeline/SPEC.md §7.3): fast, no sign-up,
 * safe against production.
 *
 *   node --experimental-strip-types scripts/release/smoke.ts --env stage
 *   node --experimental-strip-types scripts/release/smoke.ts --env production \
 *     --override videos=<version-id>     # pre-traffic: hit the 0% candidate
 *
 * With overrides, every request carries Cloudflare-Workers-Version-Overrides, so
 * the checks run on the candidate versions with that env's bindings; the health
 * checks of api-videos, websocket-server and admin-api assert which version
 * answered (`deployment` in their /health), waiting up to VERSION_WAIT_MS for the
 * candidate. Every other check asks once.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export type SmokeEnv = 'qa' | 'stage' | 'production';

export interface Hosts {
	web: string;
	api: string;
	realtime: string;
	adminWeb: string;
	adminApi: string;
}

export const HOSTS: Record<SmokeEnv, Hosts> = {
	qa: {
		web: 'https://videos.qa.alummahnow.net',
		api: 'https://videos.api.qa.alummahnow.net',
		realtime: 'https://realtime.qa.alummahnow.net',
		adminWeb: 'https://admin.qa.alummahnow.net',
		adminApi: 'https://admin.api.qa.alummahnow.net',
	},
	stage: {
		web: 'https://videos.stage.alummahnow.net',
		api: 'https://videos.api.stage.alummahnow.net',
		realtime: 'https://realtime.stage.alummahnow.net',
		adminWeb: 'https://admin.stage.alummahnow.net',
		adminApi: 'https://admin.api.stage.alummahnow.net',
	},
	production: {
		web: 'https://videos.alummahnow.net',
		api: 'https://videos.api.alummahnow.net',
		realtime: 'https://realtime.alummahnow.net',
		adminWeb: 'https://admin.alummahnow.net',
		adminApi: 'https://admin.api.alummahnow.net',
	},
};

/** The self-hosted live edge host per env (LIVE_PUBLIC_HOST in apps/api-videos/wrangler*.jsonc). */
export const LIVE_HOSTS: Record<SmokeEnv, string> = {
	qa: 'live.qa.alummahnow.net',
	stage: 'live.stage.alummahnow.net',
	production: 'live.alummahnow.net',
};

/** Worker names per env (prod names are historical; stage adds -stage). */
export const WORKERS: Record<'production' | 'stage', Record<string, string>> = {
	production: {
		web: 'al-ummah-now-production',
		'admin-web': 'al-ummah-admin-web',
		'api-videos': 'videos',
		processor: 'al-ummah-now-processor',
		'websocket-server': 'al-ummah-now-comms',
		scheduler: 'al-ummah-scheduler',
		'admin-api': 'al-ummah-admin-api',
	},
	stage: {
		web: 'al-ummah-now-stage',
		'admin-web': 'al-ummah-admin-web-stage',
		'api-videos': 'videos-stage',
		processor: 'al-ummah-now-processor-stage',
		'websocket-server': 'al-ummah-now-comms-stage',
		scheduler: 'al-ummah-scheduler-stage',
		'admin-api': 'al-ummah-admin-api-stage',
	},
};

/** Workers whose /health reports the serving version, and where. */
export const VERSIONED_HEALTH: { app: string; host: keyof Hosts }[] = [
	{ app: 'api-videos', host: 'api' },
	{ app: 'websocket-server', host: 'realtime' },
	{ app: 'admin-api', host: 'adminApi' },
];

export interface CheckResult {
	name: string;
	ok: boolean;
	detail: string;
}

export interface SmokeOptions {
	env: SmokeEnv;
	/** worker name → version id */
	overrides?: Record<string, string>;
	fetchImpl?: typeof fetch;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

/** How long a /health may keep answering with another version than the candidate, and the pause between tries. */
export const VERSION_WAIT_MS = 90_000;
export const VERSION_PAUSE_MS = 5_000;

export function overrideHeader(overrides: Record<string, string>): string {
	return Object.entries(overrides)
		.map(([worker, version]) => `${worker}="${version}"`)
		.join(', ');
}

/** The worker name an app has in `env` (qa has no release workers). */
export function workerName(env: SmokeEnv, app: string): string | undefined {
	return env === 'qa' ? undefined : WORKERS[env][app];
}

export async function runSmoke(opts: SmokeOptions): Promise<CheckResult[]> {
	const hosts = HOSTS[opts.env];
	const doFetch = opts.fetchImpl ?? fetch;
	const now = opts.now ?? Date.now;
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const headers: Record<string, string> = { 'User-Agent': 'al-ummah-now-release-smoke' };
	if (opts.overrides && Object.keys(opts.overrides).length) headers['Cloudflare-Workers-Version-Overrides'] = overrideHeader(opts.overrides);
	const get = (url: string) => doFetch(url, { redirect: 'manual', headers });

	const results: CheckResult[] = [];
	const check = async (name: string, fn: () => Promise<string>) => {
		try {
			results.push({ name, ok: true, detail: await fn() });
		} catch (error) {
			results.push({ name, ok: false, detail: (error as Error).message });
		}
	};
	const assert = (cond: unknown, msg: string) => {
		if (!cond) throw new Error(msg);
	};

	for (const { app, host } of VERSIONED_HEALTH) {
		await check(`${app}: health`, async () => {
			const worker = workerName(opts.env, app);
			const wanted = worker ? opts.overrides?.[worker] : undefined;
			const start = now();
			for (;;) {
				const res = await get(`${hosts[host]}/health`);
				assert(res.status === 200, `HTTP ${res.status}`);
				const body = (await res.json()) as { status?: string; deployment?: string };
				assert(body.status === 'healthy', `status ${body.status}`);
				const waited = Math.round((now() - start) / 1000);
				if (!wanted || body.deployment === wanted) return `version ${body.deployment ?? 'unknown'}${waited >= 1 && wanted ? ` (after ${waited} s)` : ''}`;
				// Edge locations learn of a new deployment at different times: one can still answer with the version
				// before it, after waitForVersions saw the candidate. Only that is waited for: an error, another status
				// or an unhealthy body fails above, at once, on every try.
				assert(now() - start + VERSION_PAUSE_MS <= VERSION_WAIT_MS, `served by version ${body.deployment}, expected candidate ${wanted} (after ${waited} s)`);
				await sleep(VERSION_PAUSE_MS);
			}
		});
	}

	await check('api-videos: public video list answers JSON', async () => {
		const res = await get(`${hosts.api}/api/videos?limit=1`);
		assert(res.status === 200, `HTTP ${res.status}`);
		assert((res.headers.get('content-type') ?? '').includes('application/json'), `content-type ${res.headers.get('content-type')}`);
		return 'HTTP 200 JSON';
	});

	// The self-hosted live edge (lib/live/edge.ts on api-videos): encoders push HLS to it and players
	// read from it. A host that answers with anything but the edge's clock is a failure. A host that
	// does not answer at all passes with a note: the release attaches it as a new custom domain
	// (custom-domains.ts) and its certificate can take minutes on the first release.
	await check('api-videos: live edge host answers', async () => {
		let res: Response;
		try {
			res = await get(`https://${LIVE_HOSTS[opts.env]}/time`);
		} catch (error) {
			return `not answering yet (${(error as Error).message}); a newly attached custom domain can take minutes`;
		}
		assert(res.status === 200, `HTTP ${res.status}`);
		const body = (await res.json().catch(() => null)) as { now?: unknown } | null;
		assert(typeof body?.now === 'number', 'no edge clock in the answer (is the host on the videos worker?)');
		return 'HTTP 200 edge clock';
	});

	await check('web: home page renders', async () => {
		const res = await get(`${hosts.web}/en`);
		assert(res.status === 200, `HTTP ${res.status}`);
		const html = await res.text();
		assert(/<html[\s>]/i.test(html), 'no HTML document');
		return 'HTTP 200 HTML';
	});

	// R4: an auth error on the callback must land on the error page, never raw JSON
	await check('web: sign-in callback error goes to the error page', async () => {
		const res = await get(`${hosts.web}/api/callback?error=access_denied&state=release-smoke`);
		assert(res.status >= 300 && res.status < 400, `HTTP ${res.status} (expected a redirect)`);
		const location = new URL(res.headers.get('location') ?? '', hosts.web);
		assert(location.origin === hosts.web && /\/auth\/error\b/.test(location.pathname), `redirected to ${location}`);
		return `redirect to ${location.pathname}`;
	});

	// What crawlers see (wiki AUN-SEO). seo.spec checks every page type on the local stack against the
	// PR's build; these are the parts only a real host can show: production indexable with its sitemap,
	// every other env noindex, and canonical/hreflang absolute on the env's own https host.
	const production = opts.env === 'production';

	await check('web: robots.txt', async () => {
		const res = await get(`${hosts.web}/robots.txt`);
		assert(res.status === 200, `HTTP ${res.status}`);
		const { groups, sitemaps } = parseRobots(await res.text());
		const everyone = groups.filter((g) => g.agents.includes('*'));
		assert(everyone.length > 0, 'no User-agent: * group');
		const disallowAll = everyone.some((g) => g.rules.includes('disallow: /'));
		if (!production) {
			assert(disallowAll, 'a non-production robots.txt must disallow everything');
			return 'Disallow: / (non-production)';
		}
		assert(!disallowAll, 'production robots.txt disallows everything for User-agent: *');
		assert(sitemaps.includes(`${hosts.web}/sitemap.xml`), `no Sitemap: ${hosts.web}/sitemap.xml`);
		return 'indexable, sitemap listed';
	});

	await check('web: sitemap index lists this host', async () => {
		const res = await get(`${hosts.web}/sitemap.xml`);
		assert(res.status === 200, `HTTP ${res.status}`);
		assert(/xml/.test(res.headers.get('content-type') ?? ''), `content-type ${res.headers.get('content-type')}`);
		const xml = await res.text();
		assert(/<sitemapindex[\s>]/.test(xml), 'not a sitemap index');
		const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
		assert(locs.length > 0, 'no <loc> entries');
		const foreign = locs.filter((l) => !l.startsWith(`${hosts.web}/`));
		assert(foreign.length === 0, `<loc> off this host: ${foreign.slice(0, 3).join(', ')}`);
		return `${locs.length} sitemap(s)`;
	});

	await check('web: home page head (canonical, hreflang, og:image, robots)', async () => {
		const res = await get(`${hosts.web}/en`);
		assert(res.status === 200, `HTTP ${res.status}`);
		const robots = res.headers.get('x-robots-tag') ?? '';
		if (production) assert(!/noindex/i.test(robots), `production home sends X-Robots-Tag: ${robots}`);
		else assert(/noindex/i.test(robots), 'a non-production home must send X-Robots-Tag: noindex');
		const head = headLinks(await res.text());
		assert(head.canonical.length === 1, `${head.canonical.length} canonical links`);
		assert(head.canonical[0] === `${hosts.web}/en`, `canonical ${head.canonical[0]} (expected ${hosts.web}/en)`);
		for (const lang of ['en', 'ar', 'x-default']) {
			const href = head.alternates[lang];
			assert(href?.startsWith(`${hosts.web}/`), `hreflang ${lang}: ${href ?? 'missing'}`);
		}
		assert(head.ogImage.length > 0, 'no og:image');
		assert(/^https:\/\//.test(head.ogImage[0]), `og:image not absolute https: ${head.ogImage[0]}`);
		return production ? 'indexable, self-canonical, en/ar/x-default' : 'noindex, self-canonical, en/ar/x-default';
	});

	await check('admin-web: answers', async () => {
		const res = await get(`${hosts.adminWeb}/`);
		assert(res.status >= 200 && res.status < 400, `HTTP ${res.status}`);
		return `HTTP ${res.status}`;
	});

	return results;
}

/** robots.txt parsed: its groups (user agents, lowercased "field: value" rules) and its Sitemap lines. */
export function parseRobots(text: string): { groups: { agents: string[]; rules: string[] }[]; sitemaps: string[] } {
	const groups: { agents: string[]; rules: string[] }[] = [];
	const sitemaps: string[] = [];
	let current: { agents: string[]; rules: string[] } | null = null;
	let lastWasAgent = false;
	for (const raw of text.split(/\r?\n/)) {
		const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*$/, '').trim());
		if (!match) continue;
		const field = match[1].toLowerCase();
		const value = match[2].trim();
		if (field === 'sitemap') {
			sitemaps.push(value);
		} else if (field === 'user-agent') {
			// Consecutive User-agent lines share one group
			if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
			current.agents.push(value);
			lastWasAgent = true;
			continue;
		} else if (current) {
			current.rules.push(`${field}: ${value.toLowerCase()}`);
		}
		lastWasAgent = false;
	}
	return { groups, sitemaps };
}

/** The head's canonical links, hreflang alternates and og:image values (attribute order free). */
export function headLinks(html: string): { canonical: string[]; alternates: Record<string, string>; ogImage: string[] } {
	const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2].replace(/&amp;/g, '&')]));
	const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
	const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
	const alternates: Record<string, string> = {};
	for (const l of links) if (l.rel === 'alternate' && l.hreflang) alternates[l.hreflang] = l.href;
	return {
		canonical: links.filter((l) => l.rel === 'canonical').map((l) => l.href),
		alternates,
		ogImage: metas.filter((m) => m.property === 'og:image').map((m) => m.content),
	};
}

function parseArgs(argv: string[]): SmokeOptions {
	const opts: SmokeOptions = { env: 'stage', overrides: {} };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--env') opts.env = argv[++i] as SmokeEnv;
		else if (argv[i] === '--override') {
			const [worker, version] = argv[++i].split('=');
			opts.overrides![worker] = version;
		}
	}
	if (!(opts.env in HOSTS)) throw new Error(`unknown --env ${opts.env}`);
	return opts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const opts = parseArgs(process.argv.slice(2));
	const results = await runSmoke(opts);
	for (const r of results) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}\n`);
	const failed = results.filter((r) => !r.ok);
	process.stdout.write(`\n${results.length - failed.length}/${results.length} smoke checks passed (${opts.env}).\n`);
	if (failed.length) process.exit(1);
}
