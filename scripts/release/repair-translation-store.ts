/**
 * One-off repair of an environment's translation store for #982.
 *
 * Before #982 the store (api-videos' global_settings R2 bucket,
 * translations/{en,ar}.json) held a full copy of the strings and the copy won
 * over the repo for every key, so repo copy changes never reached an
 * environment once its store existed. Now each file lists the keys an admin
 * edited in `overrides`, and only those win. This script gives a legacy file
 * (no `overrides`) its list:
 *
 * - every key whose stored value differs from the repo is classified:
 *   - stale: the stored value is a value the repo itself had at some commit
 *     (the store was seeded or copied from an older build), so it is updated
 *     to the repo text;
 *   - admin-edited: a value the repo never had, kept and listed in `overrides`.
 * - the file is rewritten with the repo text plus the kept edits, a bumped
 *   version (so clients refetch) and matching metadata.json checksums.
 *
 * A file that already has `overrides` is only refreshed (unedited keys set to
 * the repo text). The default is a dry run that prints the classification.
 *
 * Usage (from the repo root, full git history needed):
 *   pnpm exec tsx scripts/release/repair-translation-store.ts --env qa|stage|production [--apply] [--report out.json]
 * Production also needs --allow-production with --apply.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfToken, DEFAULT_ACCOUNT_ID } from './cf-api.ts';
import { parseJsonc } from './jsonc.ts';
import { checkTranslationsServed, computeChecksum, KEYS, LOCALES, r2Client, type Locale } from './seed-translations.ts';
import * as overridesModule from '../../packages/shared-types/src/i18n-overrides.ts';

// tsx loads shared-types (no "type": "module") as CommonJS, plain node as ESM
const { applyTranslationOverrides, differingTranslationPaths, flattenTranslations, storedOverrides } =
	((overridesModule as { default?: typeof overridesModule }).default ?? overridesModule) as typeof overridesModule;

export type RepairEnv = 'qa' | 'stage' | 'production';

/** Per leaf path, the JSON of every value the repo has had for it. */
export type RepoHistory = Record<string, string[]>;

export interface KeyDiff {
	path: string;
	stored: unknown;
	repo: unknown;
}

export interface LocaleRepair {
	legacy: boolean;
	/** Kept: admin edits (listed in `overrides`). */
	adminEdited: KeyDiff[];
	/** Updated to the repo text (or dropped when the repo no longer has the key). */
	stale: KeyDiff[];
	/** The file to write, or null when nothing changes. */
	next: Record<string, unknown> | null;
}

function bump(version: string): string {
	const [major, minor, patch] = version.split('.').map(Number);
	return `${major}.${minor}.${patch + 1}`;
}

/** Highest `major.minor.patch` among the given versions (1.0.0 when none). */
export function topVersion(versions: unknown[]): string {
	const parsed = versions
		.map((v) => (typeof v === 'string' ? v.split('.').map(Number) : []))
		.filter((p) => p.length === 3 && p.every((n) => Number.isInteger(n) && n >= 0));
	parsed.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
	return (parsed.at(-1) ?? [1, 0, 0]).join('.');
}

export function planLocaleRepair(
	stored: Record<string, unknown>,
	defaults: unknown,
	history: RepoHistory,
	version: string,
	now: string,
): LocaleRepair {
	const repo = flattenTranslations(defaults);
	const values = flattenTranslations(stored.translations);
	const listed = storedOverrides(stored);
	const diff = (path: string): KeyDiff => ({ path, stored: values[path], repo: repo[path] });
	const differing = differingTranslationPaths(defaults, stored.translations);

	let edited: string[];
	if (listed) {
		edited = listed.filter((p) => p in values);
	} else {
		edited = differing.filter((p) => !(history[p] ?? []).includes(JSON.stringify(values[p])));
	}
	const editedSet = new Set(edited);
	const translations = applyTranslationOverrides(defaults, stored.translations, edited);
	const unchanged = listed !== null && JSON.stringify(translations) === JSON.stringify(stored.translations);
	return {
		legacy: listed === null,
		adminEdited: edited.map(diff),
		stale: differing.filter((p) => !editedSet.has(p)).map(diff),
		next: unchanged
			? null
			: { version, locale: stored.locale, updatedAt: now, translations, overrides: [...edited].sort() },
	};
}

/** The metadata file after the locale files are rewritten. */
export function repairedMetadata(
	metadata: Record<string, unknown> | null,
	files: Record<Locale, string>,
	version: string,
	now: string,
): Record<string, unknown> {
	const en = JSON.parse(files.en) as { translations?: Record<string, unknown> };
	return {
		locales: [...LOCALES],
		defaultLocale: 'en',
		...(metadata ?? {}),
		version,
		updatedAt: now,
		checksums: { ...((metadata?.checksums as object) ?? {}), ...Object.fromEntries(LOCALES.map((l) => [l, computeChecksum(files[l])])) },
		sections: Object.keys(en.translations ?? {}),
	};
}

export const API_URLS: Record<RepairEnv, string> = {
	qa: 'https://videos.api.qa.alummahnow.net',
	stage: 'https://videos.api.stage.alummahnow.net',
	production: 'https://videos.api.alummahnow.net',
};

/** api-videos' global_settings bucket for the environment, from its wrangler config. */
export function repairBucket(env: RepairEnv, root: string): string {
	const dir = join(root, 'apps/api-videos');
	const prod = parseJsonc(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')) as any;
	const cfg = env === 'qa' ? (parseJsonc(readFileSync(join(dir, 'wrangler.qa.jsonc'), 'utf8')) as any) : env === 'stage' ? prod.env?.stage : prod;
	const bucket = cfg?.r2_buckets?.find((b: any) => b.binding === 'global_settings')?.bucket_name;
	if (!bucket) throw new Error(`api-videos config for ${env} has no global_settings bucket`);
	return bucket;
}

/**
 * Every value the repo's static translations have had: each commit that
 * touched them is extracted and imported (needs tsx for the extensionless
 * imports). Commits that fail to import are skipped and counted.
 */
async function repoHistory(root: string): Promise<{ history: Record<Locale, RepoHistory>; commits: number; failed: number }> {
	const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
	const paths = ['packages/shared-types/src', 'apps/web/src/lib/i18n'];
	const commits = git('log', '--format=%H', '--', ...paths).trim().split('\n').filter(Boolean);
	const history: Record<Locale, RepoHistory> = { en: {}, ar: {} };
	const tmp = mkdtempSync(join(tmpdir(), 'i18n-history-'));
	let failed = 0;
	try {
		for (const commit of commits) {
			const dir = join(tmp, commit);
			// git archive fails when a path is absent at that commit: only ask for the ones present
			const present = paths.filter((p) => git('ls-tree', '--name-only', commit, p).trim() !== '');
			execFileSync('sh', ['-c', `mkdir -p "${dir}" && git -C "${root}" archive ${commit} -- ${present.join(' ')} | tar -x -C "${dir}"`]);
			for (const locale of LOCALES) {
				const shared = join(dir, `packages/shared-types/src/i18n-static/${locale}.ts`);
				const file = existsSync(shared) ? shared : join(dir, `apps/web/src/lib/i18n/translations/${locale}.ts`);
				try {
					const mod = await import(file);
					const tree = mod[locale === 'en' ? 'EN_TRANSLATIONS' : 'AR_TRANSLATIONS'];
					if (!tree) throw new Error('no export');
					for (const [path, value] of Object.entries(flattenTranslations(tree))) {
						const json = JSON.stringify(value);
						const seen = (history[locale][path] ??= []);
						if (!seen.includes(json)) seen.push(json);
					}
				} catch {
					failed++;
				}
			}
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	return { history, commits: commits.length, failed };
}

const show = (v: unknown) => (v === undefined ? '(none)' : JSON.stringify(v));

async function main(): Promise<void> {
	const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
	const env = arg('--env') as RepairEnv;
	if (!['qa', 'stage', 'production'].includes(env)) throw new Error('usage: repair-translation-store.ts --env qa|stage|production [--apply] [--report file]');
	const apply = process.argv.includes('--apply');
	if (apply && env === 'production' && !process.argv.includes('--allow-production')) {
		throw new Error('production needs --allow-production (after the owner approved the dry-run list)');
	}
	const root = join(import.meta.dirname, '..', '..');
	const bucket = repairBucket(env, root);
	const token = cfToken();
	if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
	const r2 = r2Client(bucket, token, process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID);

	const [{ EN_TRANSLATIONS }, { AR_TRANSLATIONS }] = await Promise.all([
		import('../../packages/shared-types/src/i18n-static/en.ts'),
		import('../../packages/shared-types/src/i18n-static/ar.ts'),
	]);
	const defaults: Record<Locale, unknown> = { en: EN_TRANSLATIONS, ar: AR_TRANSLATIONS };
	const raw = { en: await r2.get(KEYS.en), ar: await r2.get(KEYS.ar), metadata: await r2.get(KEYS.metadata) };
	if (!raw.en || !raw.ar) throw new Error(`${bucket}: a locale file is missing; run seed-translations.ts instead`);
	const stored = { en: JSON.parse(raw.en), ar: JSON.parse(raw.ar) } as Record<Locale, Record<string, unknown>>;
	const metadata = raw.metadata ? (JSON.parse(raw.metadata) as Record<string, unknown>) : null;

	const { history, commits, failed } = await repoHistory(root);
	console.log(`repo history: ${commits} commits, ${failed} locale snapshots skipped`);
	const version = bump(topVersion([stored.en.version, stored.ar.version, metadata?.version]));
	const now = new Date().toISOString();
	const plans = Object.fromEntries(
		LOCALES.map((l) => [l, planLocaleRepair(stored[l], defaults[l], history[l], version, now)]),
	) as Record<Locale, LocaleRepair>;

	for (const l of LOCALES) {
		const p = plans[l];
		console.log(`\n${bucket}/${KEYS[l]} (v${stored[l].version}, ${p.legacy ? 'no overrides list' : 'has overrides list'}): ${p.adminEdited.length} admin-edited (kept), ${p.stale.length} stale (updated)`);
		for (const d of p.adminEdited) console.log(`  KEEP   ${d.path}: store ${show(d.stored)} | repo ${show(d.repo)}`);
		for (const d of p.stale) console.log(`  UPDATE ${d.path}: store ${show(d.stored)} -> repo ${show(d.repo)}`);
	}
	const report = arg('--report');
	if (report) writeFileSync(report, JSON.stringify({ env, bucket, version, plans: Object.fromEntries(LOCALES.map((l) => [l, { ...plans[l], next: undefined }])) }, null, 2));

	const writes = LOCALES.filter((l) => plans[l].next);
	if (!apply) {
		console.log(`\ndry run: ${writes.length ? `would rewrite ${writes.map((l) => KEYS[l]).join(', ')} and ${KEYS.metadata} at v${version}` : 'nothing to write'}`);
		return;
	}
	if (!writes.length) {
		console.log('\nnothing to write');
		return;
	}
	// An admin save since the read wins: stop rather than overwrite it
	for (const l of LOCALES) {
		if ((await r2.get(KEYS[l])) !== raw[l]) throw new Error(`${KEYS[l]} changed since it was read; run again`);
	}
	const files = Object.fromEntries(
		LOCALES.map((l) => [l, plans[l].next ? JSON.stringify(plans[l].next, null, 2) : raw[l]!]),
	) as Record<Locale, string>;
	for (const l of writes) await r2.put(KEYS[l], files[l]);
	await r2.put(KEYS.metadata, JSON.stringify(repairedMetadata(metadata, files, version, now), null, 2));
	console.log(`\nwrote ${writes.map((l) => KEYS[l]).join(', ')} and ${KEYS.metadata} at v${version}`);
	await checkTranslationsServed(API_URLS[env]);
	console.log(`${API_URLS[env]}/api/i18n/translations/{en,ar}: 200`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
