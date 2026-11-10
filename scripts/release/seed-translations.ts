/**
 * Seeds an environment's translation store with whatever files it is missing,
 * then checks the public API serves both locales.
 *
 * The store is the global_settings R2 bucket: translations/{en,ar}.json and
 * translations/metadata.json, read by api-videos (GET /api/i18n/translations/:locale)
 * and edited by admin-api (the admin Translations page). Nothing created them
 * on a fresh environment: stage answered 404 for both locales and every page
 * logged console errors until someone copied production's files over by hand.
 *
 * Only missing files are written, so edits made in that environment survive
 * every release. The seed is the repo's source of truth, the static
 * translations in @al-ummah/shared-types (the same objects POST /api/i18n/sync
 * and the web app's fallback use).
 *
 * Usage: tsx scripts/release/seed-translations.ts --env qa|stage [--dry-run]
 * (tsx, not plain node: shared-types' sources use extensionless imports).
 * Never production: production's store holds the edited, live copy.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfToken, DEFAULT_ACCOUNT_ID } from './cf-api.ts';
import { parseJsonc } from './jsonc.ts';

export type SeedEnv = 'qa' | 'stage';
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const KEYS = {
	en: 'translations/en.json',
	ar: 'translations/ar.json',
	metadata: 'translations/metadata.json',
} as const;

export const API_URLS: Record<SeedEnv, string> = {
	qa: 'https://videos.api.qa.alummahnow.net',
	stage: 'https://videos.api.stage.alummahnow.net',
};

/** Same checksum admin-api writes into metadata.json (translationsUpdate.ts). */
export function computeChecksum(data: string): string {
	let sum = 0;
	for (let i = 0; i < data.length; i++) sum += data.charCodeAt(i);
	return `${data.length}-${sum.toString(16)}`;
}

function versionOf(json: string | null): [number, number, number] | null {
	if (!json) return null;
	try {
		const parts = String((JSON.parse(json) as { version?: unknown }).version ?? '').split('.').map(Number);
		return parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0) ? (parts as [number, number, number]) : null;
	} catch {
		return null;
	}
}

export interface StoredFiles {
	en: string | null;
	ar: string | null;
	metadata: string | null;
}

export interface SeedWrite {
	key: string;
	body: string;
}

/**
 * The files to write: one per missing locale file, from the defaults, and
 * metadata.json when it is missing, describing the locale files as they will
 * stand. Files that exist are never rewritten, even when they differ from the
 * defaults. New files take the highest version already stored (1.0.0 in an
 * empty store), so a client's cached copy of an existing file stays valid.
 */
export function planTranslationSeed(stored: StoredFiles, defaults: Record<Locale, unknown>, now: string): SeedWrite[] {
	const versions = [stored.en, stored.ar, stored.metadata].map(versionOf).filter((v) => v !== null);
	versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
	const top = versions.at(-1);
	const version = top ? top.join('.') : '1.0.0';

	const writes: SeedWrite[] = [];
	const finalJson = {} as Record<Locale, string>;
	for (const locale of LOCALES) {
		const existing = stored[locale];
		if (existing !== null) {
			finalJson[locale] = existing;
			continue;
		}
		const body = JSON.stringify({ version, locale, updatedAt: now, translations: defaults[locale] }, null, 2);
		finalJson[locale] = body;
		writes.push({ key: KEYS[locale], body });
	}

	if (stored.metadata === null) {
		const en = JSON.parse(finalJson.en) as { translations?: Record<string, unknown> };
		const metadata = {
			version,
			locales: [...LOCALES],
			defaultLocale: 'en',
			updatedAt: now,
			checksums: Object.fromEntries(LOCALES.map((l) => [l, computeChecksum(finalJson[l])])),
			sections: Object.keys(en.translations ?? {}),
		};
		writes.push({ key: KEYS.metadata, body: JSON.stringify(metadata, null, 2) });
	}
	return writes;
}

/** api-videos' global_settings bucket for the environment, from its wrangler config. */
export function translationBucket(env: SeedEnv, root: string): string {
	const dir = join(root, 'apps/api-videos');
	const prod = parseJsonc(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')) as any;
	const cfg = env === 'qa' ? (parseJsonc(readFileSync(join(dir, 'wrangler.qa.jsonc'), 'utf8')) as any) : prod.env?.stage;
	const bucket = cfg?.r2_buckets?.find((b: any) => b.binding === 'global_settings')?.bucket_name;
	if (!bucket) throw new Error(`api-videos config for ${env} has no global_settings bucket`);
	if (bucket === prod.r2_buckets?.find((b: any) => b.binding === 'global_settings')?.bucket_name) {
		throw new Error(`${env} resolves to production's bucket (${bucket}); refusing to seed it`);
	}
	return bucket;
}

interface R2 {
	/** Keys under the prefix: one list call (object GETs are rate limited hard). */
	list(prefix: string): Promise<Set<string>>;
	get(key: string): Promise<string | null>;
	put(key: string, body: string): Promise<void>;
}

/** fetch, retried on 429/5xx (the account's API token is shared by every job) with backoff. */
async function fetchRetry(url: string, init: RequestInit, attempts = 6): Promise<Response> {
	for (let i = 1; ; i++) {
		const res = await fetch(url, init);
		if (i >= attempts || (res.status !== 429 && res.status < 500)) return res;
		const retryAfter = Number(res.headers.get('retry-after'));
		console.warn(`${init.method ?? 'GET'} ${url.split('/r2/')[1] ?? url}: HTTP ${res.status}, retry ${i}/${attempts - 1}`);
		await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** i, 60000)));
	}
}

function r2Client(bucket: string, token: string, accountId: string): R2 {
	const url = (key: string) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
	const headers = { Authorization: `Bearer ${token}` };
	return {
		async list(prefix) {
			const qs = new URLSearchParams({ prefix, per_page: '1000' });
			const res = await fetchRetry(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects?${qs}`, { headers });
			const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { key: string }[] };
			if (!res.ok || !json.success) throw new Error(`listing ${bucket}/${prefix} -> HTTP ${res.status}`);
			return new Set((json.result ?? []).map((o) => o.key));
		},
		async get(key) {
			const res = await fetchRetry(url(key), { headers });
			if (res.status === 404) return null;
			if (!res.ok) throw new Error(`GET ${bucket}/${key} -> HTTP ${res.status}`);
			return res.text();
		},
		async put(key, body) {
			const res = await fetchRetry(url(key), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body });
			if (!res.ok) throw new Error(`PUT ${bucket}/${key} -> HTTP ${res.status}`);
		},
	};
}

/** Throws unless GET /api/i18n/translations/<locale> answers 200 with translations, for each locale. */
export async function checkTranslationsServed(api: string, fetchFn: typeof fetch = fetch): Promise<void> {
	const failures: string[] = [];
	for (const locale of LOCALES) {
		const res = await fetchFn(`${api}/api/i18n/translations/${locale}`);
		const body = res.ok ? ((await res.json().catch(() => null)) as { result?: { translations?: object } } | null) : null;
		if (!res.ok || !body?.result?.translations) failures.push(`${locale}: HTTP ${res.status}${res.ok ? ' without translations' : ''}`);
	}
	if (failures.length) throw new Error(`${api}/api/i18n/translations: ${failures.join('; ')}`);
}

async function main(): Promise<void> {
	const env = process.argv[process.argv.indexOf('--env') + 1] as SeedEnv;
	if (env !== 'qa' && env !== 'stage') throw new Error('usage: seed-translations.ts --env qa|stage [--dry-run]');
	const dryRun = process.argv.includes('--dry-run');
	const root = join(import.meta.dirname, '..', '..');
	const bucket = translationBucket(env, root);
	const token = cfToken();
	if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
	const r2 = r2Client(bucket, token, process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID);

	const [{ EN_TRANSLATIONS }, { AR_TRANSLATIONS }] = await Promise.all([
		import('../../packages/shared-types/src/i18n-static/en.ts'),
		import('../../packages/shared-types/src/i18n-static/ar.ts'),
	]);
	const present = await r2.list('translations/');
	const missing = Object.values(KEYS).filter((key) => !present.has(key));
	// Contents are only needed to build what is missing (versions, checksums)
	const read = async (key: string) => (missing.length && present.has(key) ? r2.get(key) : present.has(key) ? '' : null);
	const stored: StoredFiles = { en: await read(KEYS.en), ar: await read(KEYS.ar), metadata: await read(KEYS.metadata) };
	const writes = missing.length ? planTranslationSeed(stored, { en: EN_TRANSLATIONS, ar: AR_TRANSLATIONS }, new Date().toISOString()) : [];

	// Re-check just before writing: a file an admin saved since the listing wins
	const stillMissing = writes.length && !dryRun ? await r2.list('translations/') : new Set<string>();
	for (const key of Object.values(KEYS)) {
		const write = writes.find((w) => w.key === key);
		console.log(`${bucket}/${key}: ${write ? (dryRun ? 'missing (dry run: not written)' : 'missing, seeded from the repo defaults') : 'present, kept'}`);
		if (write && !dryRun && !stillMissing.has(key)) await r2.put(key, write.body);
	}
	if (!dryRun) {
		await checkTranslationsServed(API_URLS[env]);
		console.log(`${API_URLS[env]}/api/i18n/translations/{en,ar}: 200`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
