/**
 * Syncs an environment's translation store with the repo on every deploy
 * (#982), then checks it.
 *
 * The store is api-videos' global_settings R2 bucket: translations/{en,ar}.json
 * and translations/metadata.json. Each locale file lists the keys an admin
 * edited in `overrides`; those keep their stored value. Every other key is set
 * to the repo's static translations (@al-ummah/shared-types), keys the repo no
 * longer has are dropped, and missing files are seeded from the repo.
 *
 *   tsx scripts/release/sync-translations.ts --env qa|stage|production [--dry-run]
 *   tsx scripts/release/sync-translations.ts --env qa|stage|production --check
 *
 * `--check` (the release smoke check) only reads: it fails when a locale file
 * is missing, has no `overrides` list, or holds a key outside that list whose
 * value differs from the repo (or that the repo does not have).
 *
 * A file without `overrides` (written before #982) cannot be told apart from
 * admin edits without git history, so sync keeps every differing key as an
 * edit and warns; scripts/release/repair-translation-store.ts classifies such
 * a file properly. Both lines go to $GITHUB_STEP_SUMMARY when it is set:
 * "translations: N updated, M kept".
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfToken, DEFAULT_ACCOUNT_ID } from './cf-api.ts';
import { checkTranslationsServed, KEYS, LOCALES, planTranslationSeed, r2Client, type Locale, type R2 } from './seed-translations.ts';
import { API_URLS, planLocaleRepair, repairBucket, repairedMetadata, topVersion, type RepairEnv } from './repair-translation-store.ts';
import * as overridesModule from '../../packages/shared-types/src/i18n-overrides.ts';

// tsx loads shared-types (no "type": "module") as CommonJS, plain node as ESM
const { flattenTranslations, storedOverrides } = ((overridesModule as { default?: typeof overridesModule }).default ??
	overridesModule) as typeof overridesModule;

export interface StoreFiles {
	en: string | null;
	ar: string | null;
	metadata: string | null;
}

export interface SyncPlan {
	writes: { key: string; body: string }[];
	/** Keys whose stored value changes (set to the repo text, added or dropped). */
	updated: number;
	/** Keys kept as admin edits. */
	kept: number;
	/** Locales whose file had no `overrides` list (every differing key kept). */
	legacy: Locale[];
}

/** Leaf paths whose value differs between two translation trees (added, changed or removed). */
export function changedKeyCount(before: unknown, after: unknown): number {
	const a = flattenTranslations(before);
	const b = flattenTranslations(after);
	const paths = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...paths].filter((p) => !(p in a) || !(p in b) || JSON.stringify(a[p]) !== JSON.stringify(b[p])).length;
}

export function planTranslationSync(stored: StoreFiles, defaults: Record<Locale, unknown>, now: string): SyncPlan {
	if (stored.en === null || stored.ar === null || stored.metadata === null) {
		// Seed what is missing first; existing locale files are synced on the next pass
		const writes = planTranslationSeed(stored, defaults, now);
		const seeded = LOCALES.filter((l) => stored[l] === null);
		const updated = seeded.reduce((n, l) => n + Object.keys(flattenTranslations(defaults[l])).length, 0);
		const rest = planTranslationSync(
			{
				en: writes.find((w) => w.key === KEYS.en)?.body ?? stored.en,
				ar: writes.find((w) => w.key === KEYS.ar)?.body ?? stored.ar,
				metadata: writes.find((w) => w.key === KEYS.metadata)?.body ?? stored.metadata,
			},
			defaults,
			now,
		);
		const byKey = new Map([...writes, ...rest.writes].map((w) => [w.key, w]));
		return { writes: [...byKey.values()], updated: updated + rest.updated, kept: rest.kept, legacy: rest.legacy };
	}
	const parsed = { en: JSON.parse(stored.en), ar: JSON.parse(stored.ar) } as Record<Locale, Record<string, unknown>>;
	const metadata = JSON.parse(stored.metadata) as Record<string, unknown>;
	const version = topVersion([parsed.en.version, parsed.ar.version, metadata.version]).split('.').map(Number);
	const next = `${version[0]}.${version[1]}.${version[2] + 1}`;
	const plans = Object.fromEntries(LOCALES.map((l) => [l, planLocaleRepair(parsed[l], defaults[l], {}, next, now)])) as Record<
		Locale,
		ReturnType<typeof planLocaleRepair>
	>;
	const files = Object.fromEntries(
		LOCALES.map((l) => [l, plans[l].next ? JSON.stringify(plans[l].next, null, 2) : (stored[l] as string)]),
	) as Record<Locale, string>;
	const changed = LOCALES.filter((l) => plans[l].next);
	const writes = changed.map((l) => ({ key: KEYS[l], body: files[l] }));
	if (writes.length) writes.push({ key: KEYS.metadata, body: JSON.stringify(repairedMetadata(metadata, files, next, now), null, 2) });
	return {
		writes,
		updated: changed.reduce((n, l) => n + changedKeyCount(parsed[l].translations, (plans[l].next as { translations: unknown }).translations), 0),
		kept: LOCALES.reduce((n, l) => n + plans[l].adminEdited.length, 0),
		legacy: LOCALES.filter((l) => plans[l].legacy),
	};
}

/** Problems that make the store disagree with the repo outside its override list (empty = in sync). */
export function storeDrift(stored: StoreFiles, defaults: Record<Locale, unknown>): string[] {
	const problems: string[] = [];
	for (const locale of LOCALES) {
		const raw = stored[locale];
		if (raw === null) {
			problems.push(`${KEYS[locale]} is missing`);
			continue;
		}
		const data = JSON.parse(raw) as Record<string, unknown>;
		const overrides = storedOverrides(data);
		if (!overrides) {
			problems.push(`${KEYS[locale]} has no overrides list`);
			continue;
		}
		const listed = new Set(overrides);
		const repo = flattenTranslations(defaults[locale]);
		const values = flattenTranslations(data.translations);
		for (const [path, value] of Object.entries(repo)) {
			if (listed.has(path)) continue;
			if (!(path in values)) problems.push(`${locale} ${path}: missing (repo ${JSON.stringify(value)})`);
			else if (JSON.stringify(values[path]) !== JSON.stringify(value)) {
				problems.push(`${locale} ${path}: store ${JSON.stringify(values[path])} != repo ${JSON.stringify(value)}`);
			}
		}
		for (const path of Object.keys(values)) {
			if (!(path in repo) && !listed.has(path)) problems.push(`${locale} ${path}: not in the repo and not an override`);
		}
	}
	return problems;
}

function summary(line: string): void {
	console.log(line);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function readStore(r2: R2): Promise<StoreFiles> {
	return { en: await r2.get(KEYS.en), ar: await r2.get(KEYS.ar), metadata: await r2.get(KEYS.metadata) };
}

async function main(): Promise<void> {
	const env = process.argv[process.argv.indexOf('--env') + 1] as RepairEnv;
	if (!['qa', 'stage', 'production'].includes(env)) throw new Error('usage: sync-translations.ts --env qa|stage|production [--dry-run|--check]');
	const dryRun = process.argv.includes('--dry-run');
	const check = process.argv.includes('--check');
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

	if (check) {
		const problems = storeDrift(await readStore(r2), defaults);
		for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
		if (problems.length) throw new Error(`${bucket}: ${problems.length} translation key(s) differ from the repo outside the overrides list`);
		await checkTranslationsServed(API_URLS[env]);
		console.log(`${bucket}: every non-override key matches the repo; ${API_URLS[env]}/api/i18n/translations/{en,ar}: 200`);
		return;
	}

	// An admin save between the read and the write wins: plan again from the new files
	for (let attempt = 1; ; attempt++) {
		const stored = await readStore(r2);
		const plan = planTranslationSync(stored, defaults, new Date().toISOString());
		for (const l of plan.legacy) {
			console.warn(`::warning title=Translation store::${bucket}/${KEYS[l]} has no overrides list; every differing key was kept. Run scripts/release/repair-translation-store.ts --env ${env}.`);
		}
		if (dryRun || !plan.writes.length) {
			summary(`translations: ${plan.updated} updated, ${plan.kept} kept (${env}${dryRun ? ', dry run' : ''})`);
			return;
		}
		const now = await readStore(r2);
		if (LOCALES.some((l) => now[l] !== stored[l])) {
			if (attempt >= 3) throw new Error(`${bucket}: translation files keep changing; run again`);
			continue;
		}
		for (const write of plan.writes) await r2.put(write.key, write.body);
		summary(`translations: ${plan.updated} updated, ${plan.kept} kept (${env})`);
		return;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
