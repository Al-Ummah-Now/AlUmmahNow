/**
 * Release check: no surface serves a thumbnail that is expired, about to expire
 * while still cached, or that carries a token it must not (2026-11-12 incident:
 * stored signed Bunny URLs turned into 403s; 2026-11-13 audit: www JSON-LD gave
 * crawlers signed URLs).
 *
 *   node --experimental-strip-types --no-warnings scripts/release/thumbnail-check.ts --env stage|production [--strict-stored]
 *
 * Anonymous GETs only. Image URLs are read from structured places (JSON bodies,
 * meta tags, JSON-LD, src/poster attributes), never by scanning page scripts,
 * so a URL split across streamed chunks can't produce a false failure.
 *
 * Fails on:
 *   - expired: any thumbnail whose token `expires` (Bunny) or /priv/<expires> (R2) is in the past;
 *   - playback token on an image: a path-form directory token (bcdn_token) on an image URL;
 *   - signed share image: og:image, twitter:image, oEmbed thumbnail_url, embed posters or
 *     JSON-LD thumbnailUrl that carry a token (crawlers cache them for days);
 *   - stable share image broken: /thumb/<id>.jpg of a public video is not an image, or an
 *     unknown id is not 404;
 *   - unreachable: a sampled thumbnail answers 403/404.
 * Signed thumbnails that www or the CMS store (KV feed, D1 snapshots) are a warning until
 * those repos serve /thumb; --strict-stored (or THUMB_CHECK_STRICT_STORED=1) makes them fail.
 */
import { pathToFileURL } from 'node:url';

export type CheckEnv = 'stage' | 'production';
type Level = 'fail' | 'warn';
export interface Finding {
	level: Level;
	rule: string;
	surface: string;
	detail: string;
}

export function hosts(env: CheckEnv) {
	const s = env === 'production' ? '' : `.${env}`;
	return {
		api: `https://videos.api${s}.alummahnow.net`,
		web: `https://videos${s}.alummahnow.net`,
		www: `https://www${s}.alummahnow.net`,
		cms: `https://cms${s}.alummahnow.net/api/public/v1`,
	};
}

const IMAGE_FILE = /\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i;

/** Token form and expiry (unix seconds) of an image URL; null form when unsigned. */
export function tokenOf(url: string): { form: 'bunny-directory' | 'bunny-file' | 'r2-private' | null; expires: number | null } {
	if (url.includes('bcdn_token=')) {
		const m = /[&?]expires=(\d+)/.exec(url);
		return { form: 'bunny-directory', expires: m ? Number(m[1]) : null };
	}
	try {
		const u = new URL(url);
		if (u.searchParams.has('token') && u.searchParams.has('expires')) return { form: 'bunny-file', expires: Number(u.searchParams.get('expires')) || null };
		const priv = /^\/priv\/(\d{9,})\./.exec(u.pathname);
		if (priv && /(^|\.)media(\.[a-z]+)?\.alummahnow\.net$/.test(u.hostname)) return { form: 'r2-private', expires: Number(priv[1]) };
	} catch {
		/* not a URL */
	}
	return { form: null, expires: null };
}

const IMAGE_KEY = /(thumb|poster|image|preview|cover)/i;

/**
 * Image-looking URLs in a JSON value, by key: only string fields whose key names an image,
 * or that sit under one (thumbnailSizes.hd).
 */
export function jsonImageUrls(node: unknown, out: string[] = [], key = ''): string[] {
	if (typeof node === 'string') {
		if (/^https?:\/\//.test(node) && IMAGE_KEY.test(key)) out.push(node);
	} else if (Array.isArray(node)) {
		for (const v of node) jsonImageUrls(v, out, key);
	} else if (node && typeof node === 'object') {
		// cover: { videoId, thumbnailUrl } keeps its own key; thumbnailSizes: { hd } inherits the parent's
		for (const [k, v] of Object.entries(node)) jsonImageUrls(v, out, IMAGE_KEY.test(k) || !IMAGE_KEY.test(key) ? k : key);
	}
	return out;
}

const unescapeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** og:image / twitter:image values */
export function metaImages(html: string): string[] {
	const out: string[] = [];
	for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
		if (!/(property|name)=["'](og:image(:secure_url)?|twitter:image)["']/i.test(tag)) continue;
		const m = /content=["']([^"']+)["']/i.exec(tag);
		if (m) out.push(unescapeHtml(m[1]));
	}
	return out;
}

/** thumbnailUrl / image values inside JSON-LD blocks */
export function jsonLdImages(html: string): string[] {
	const out: string[] = [];
	for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		try {
			const walk = (n: unknown, k = ''): void => {
				if (typeof n === 'string') {
					if (/^(thumbnailUrl|image|contentUrl|thumbnail)$/i.test(k) && /^https?:\/\//.test(n)) out.push(n);
				} else if (Array.isArray(n)) n.forEach((v) => walk(v, k));
				else if (n && typeof n === 'object') for (const [kk, v] of Object.entries(n)) walk(v, kk);
			};
			walk(JSON.parse(m[1]));
		} catch {
			/* not JSON */
		}
	}
	return out;
}

/** <img src>, <video poster>, srcset entries */
export function htmlImages(html: string): string[] {
	const out: string[] = [];
	for (const m of html.matchAll(/\b(?:src|poster)=["']([^"']+)["']/gi)) {
		const u = unescapeHtml(m[1]);
		if (/^https?:\/\//.test(u) && IMAGE_FILE.test(u.split('?')[0] + (u.includes('?') ? '?' : ''))) out.push(u);
		else if (/^https?:\/\//.test(u) && tokenOf(u).form) out.push(u);
	}
	for (const m of html.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
		for (const part of unescapeHtml(m[1]).split(',')) {
			const u = part.trim().split(/\s+/)[0];
			if (/^https?:\/\//.test(u)) out.push(u);
		}
	}
	return out;
}

/**
 * Judge the image URLs one surface serves.
 * kind: 'api' (fresh per response), 'share' (cached by crawlers), 'stored' (www/CMS store them).
 */
export function judge(surface: string, kind: 'api' | 'share' | 'stored', urls: string[], nowSec: number, strictStored: boolean): Finding[] {
	const findings: Finding[] = [];
	for (const url of new Set(urls)) {
		const { form, expires } = tokenOf(url);
		if (!form) continue;
		const short = url.replace(/(bcdn_token=|token=)[^&]+/g, '$1…').slice(0, 140);
		if (expires !== null && expires <= nowSec) findings.push({ level: 'fail', rule: 'expired', surface, detail: `expired ${Math.round((nowSec - expires) / 60)} min ago: ${short}` });
		if (form === 'bunny-directory' && IMAGE_FILE.test(url)) findings.push({ level: 'fail', rule: 'playback token on an image', surface, detail: short });
		if (kind === 'share') findings.push({ level: 'fail', rule: 'signed share image', surface, detail: short });
		if (kind === 'stored') findings.push({ level: strictStored ? 'fail' : 'warn', rule: 'signed URL stored by www/CMS', surface, detail: short });
	}
	return findings;
}

interface Deps {
	fetch: typeof fetch;
	now: () => number;
}

async function text(deps: Deps, url: string, accept: string): Promise<{ status: number; body: string; type: string }> {
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await deps.fetch(url, { headers: { Accept: accept, 'User-Agent': 'aun-release-thumbnail-check' }, redirect: 'follow' });
			if (res.status >= 500 && attempt < 3) continue;
			return { status: res.status, body: await res.text(), type: res.headers.get('content-type') ?? '' };
		} catch (error) {
			if (attempt >= 3) return { status: 0, body: String(error), type: '' };
		}
	}
}

function itemsOf(d: unknown): Record<string, unknown>[] {
	if (Array.isArray(d)) return d as Record<string, unknown>[];
	if (d && typeof d === 'object') {
		for (const k of ['data', 'result', 'videos', 'items', 'results', 'videoItems']) {
			const v = (d as Record<string, unknown>)[k];
			const r = itemsOf(v);
			if (r.length) return r;
		}
	}
	return [];
}

export async function thumbnailCheck(env: CheckEnv, deps: Deps, opts: { strictStored: boolean }): Promise<{ findings: Finding[]; checked: string[] }> {
	const h = hosts(env);
	const findings: Finding[] = [];
	const checked: string[] = [];
	const now = () => Math.floor(deps.now() / 1000);
	const apiUrls: string[] = [];

	const json = async (surface: string, url: string, kind: 'api' | 'stored') => {
		const r = await text(deps, url, 'application/json');
		checked.push(surface);
		if (r.status !== 200) {
			findings.push({ level: kind === 'stored' ? 'warn' : 'fail', rule: 'surface unavailable', surface, detail: `HTTP ${r.status}` });
			return null;
		}
		let body: unknown;
		try {
			body = JSON.parse(r.body);
		} catch {
			findings.push({ level: 'fail', rule: 'surface unavailable', surface, detail: 'not JSON' });
			return null;
		}
		const urls = jsonImageUrls(body);
		if (kind === 'api') apiUrls.push(...urls);
		findings.push(...judge(surface, kind, urls, now(), opts.strictStored));
		return body;
	};

	// Videos API (signed per response)
	const list = await json('api /api/videos', `${h.api}/api/videos?limit=50`, 'api');
	const videos = itemsOf(list).filter((v) => typeof v.id === 'string' && v.isPublic !== false);
	const ids = videos.map((v) => v.id as string).slice(0, 4);
	for (const id of ids) await json(`api /api/videos/${id.slice(0, 8)}`, `${h.api}/api/videos/${id}`, 'api');
	for (const p of ['/api/videos/sections/recent', '/api/shorts', '/api/trending', '/api/search?q=a']) await json(`api ${p}`, `${h.api}${p}`, 'api');
	const playlists = itemsOf(await json('api /api/playlists', `${h.api}/api/playlists?limit=5`, 'api'));
	const playlistId = playlists.find((p) => typeof p.id === 'string')?.id as string | undefined;
	if (playlistId) await json('api playlist', `${h.api}/api/playlists/${playlistId}?includeVideos=true`, 'api');

	// Share surfaces on the videos web app
	for (const id of ids.slice(0, 2)) {
		const watch = await text(deps, `${h.web}/en/video/${id}`, 'text/html');
		checked.push(`web watch ${id.slice(0, 8)}`);
		const meta = metaImages(watch.body);
		findings.push(...judge(`web watch ${id.slice(0, 8)} meta`, 'share', meta, now(), opts.strictStored));
		for (const m of meta) if (m !== `${h.web}/thumb/${id}.jpg`) findings.push({ level: 'fail', rule: 'share image not the stable /thumb URL', surface: `web watch ${id.slice(0, 8)}`, detail: m.slice(0, 120) });
		const oembed = await json(`oembed ${id.slice(0, 8)}`, `${h.web}/oembed?url=${encodeURIComponent(`${h.web}/en/video/${id}`)}`, 'api');
		const tu = (oembed as { thumbnail_url?: string } | null)?.thumbnail_url;
		if (tu) findings.push(...judge(`oembed ${id.slice(0, 8)}`, 'share', [tu], now(), opts.strictStored));
		const embed = await text(deps, `${h.web}/embed/v/${id}`, 'text/html');
		checked.push(`embed ${id.slice(0, 8)}`);
		findings.push(...judge(`embed ${id.slice(0, 8)} poster`, 'share', htmlImages(embed.body), now(), opts.strictStored));
		const thumb = await deps.fetch(`${h.web}/thumb/${id}.jpg`, { headers: { 'User-Agent': 'aun-release-thumbnail-check' } }).catch(() => null);
		checked.push(`thumb ${id.slice(0, 8)}`);
		const type = thumb?.headers.get('content-type') ?? '';
		if (!thumb || thumb.status !== 200 || !type.startsWith('image/')) findings.push({ level: 'fail', rule: 'stable share image broken', surface: `/thumb/${id.slice(0, 8)}`, detail: `HTTP ${thumb?.status ?? 0} ${type}` });
	}
	const unknown = await deps.fetch(`${h.web}/thumb/00000000-0000-4000-8000-000000000000.jpg`, { headers: { 'User-Agent': 'aun-release-thumbnail-check' } }).catch(() => null);
	checked.push('thumb unknown id');
	if (unknown?.status !== 404) findings.push({ level: 'fail', rule: 'stable share image leaks or errors', surface: '/thumb unknown id', detail: `HTTP ${unknown?.status ?? 0} (want 404)` });

	// www and the CMS store and cache what the API returned
	for (const path of ['/en', '/en/videos', '/ar/videos']) {
		const page = await text(deps, `${h.www}${path}`, 'text/html');
		checked.push(`www ${path}`);
		if (page.status !== 200) {
			findings.push({ level: 'warn', rule: 'surface unavailable', surface: `www ${path}`, detail: `HTTP ${page.status}` });
			continue;
		}
		findings.push(...judge(`www ${path} JSON-LD`, 'share', jsonLdImages(page.body), now(), opts.strictStored).map((f) => (opts.strictStored || f.rule !== 'signed share image' ? f : { ...f, level: 'warn' as Level })));
		findings.push(...judge(`www ${path} meta`, 'share', metaImages(page.body), now(), opts.strictStored));
		findings.push(...judge(`www ${path} images`, 'stored', htmlImages(page.body), now(), opts.strictStored));
	}
	for (const path of ['/timeline?locale=en', '/home?locale=en']) await json(`cms ${path.split('?')[0]}`, `${h.cms}${path}`, 'stored');

	// A sample of thumbnails must load (Bunny 403 on a fresh token would be a real bug)
	const sample = [...new Set(apiUrls)].filter((u) => tokenOf(u).form || /b-cdn\.net|media\.|images\./.test(u)).slice(0, 10);
	for (const u of sample) {
		const r = await deps.fetch(u, { headers: { Range: 'bytes=0-1023', 'User-Agent': 'aun-release-thumbnail-check' } }).catch(() => null);
		if (!r || r.status === 403 || r.status === 404) findings.push({ level: 'fail', rule: 'thumbnail unreachable', surface: 'api sample', detail: `HTTP ${r?.status ?? 0}: ${u.replace(/(bcdn_token=|token=)[^&]+/g, '$1…').slice(0, 120)}` });
	}
	checked.push(`${sample.length} sampled thumbnails`);
	return { findings, checked };
}

async function main(argv: string[]): Promise<void> {
	const env = argv[argv.indexOf('--env') + 1] as CheckEnv;
	if (env !== 'stage' && env !== 'production') {
		process.stderr.write('usage: thumbnail-check.ts --env stage|production [--strict-stored]\n');
		process.exit(2);
	}
	const strictStored = argv.includes('--strict-stored') || process.env.THUMB_CHECK_STRICT_STORED === '1';
	const { findings, checked } = await thumbnailCheck(env, { fetch, now: () => Date.now() }, { strictStored });
	const fails = findings.filter((f) => f.level === 'fail');
	const warns = findings.filter((f) => f.level === 'warn');
	const lines = [`### Thumbnail check (${env}): ${fails.length ? 'FAILED' : 'passed'}`, `${checked.length} surfaces checked; ${fails.length} failures, ${warns.length} warnings.`, ''];
	for (const f of [...fails, ...warns]) lines.push(`- **${f.level}** ${f.rule} — ${f.surface}: ${f.detail}`);
	const out = lines.join('\n');
	process.stdout.write(out + '\n');
	if (process.env.GITHUB_STEP_SUMMARY) {
		const { appendFileSync } = await import('node:fs');
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
	}
	if (fails.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main(process.argv.slice(2)).catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}
