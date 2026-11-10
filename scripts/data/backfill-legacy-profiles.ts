/**
 * Fills empty fields of usr_ video profiles from the user's pre-SSO profile.
 *
 * Production runs this from the admin instead: Legacy profiles (admin job
 * 'profiles.restore-legacy', api-videos lib/admin/legacy-restore.ts) shows the
 * same dry run, audits every profile, backs it up to the private ADMIN_BACKUPS
 * bucket and writes conditionally. This CLI is for QA/stage checks.
 *
 *   node --experimental-strip-types scripts/data/backfill-legacy-profiles.ts --env qa            # dry run
 *   node --experimental-strip-types scripts/data/backfill-legacy-profiles.ts --env qa --apply
 *   ... --env production [--apply] [--backup-dir <dir>]
 *
 * Dry run (the default) reads the R2 `profiles` bucket of the environment and
 * prints every planned change; nothing is written. --apply first saves each
 * profile it will change, as it is in R2, to --backup-dir (default
 * $TMPDIR/profiles-backfill-<env>-<time>), re-reads it just before writing (so
 * a change made meanwhile is respected), re-plans on that fresh copy and writes
 * only if there is still something to fill. Running it again changes nothing.
 *
 * Rules (./legacy-profiles.ts, unit-tested): a legacy record (32-hex key) is
 * paired with the usr_ profile of the same email; only EMPTY fields of the usr_
 * profile are filled (Arabic names go to the `ar` slot); a doubled slash after
 * the image host is collapsed. Legacy records are left in place.
 *
 * Profiles are plain JSON objects in R2 (api-videos R2Repository); profile
 * updates are not search-indexed and the processor only logs ProfileUpdate, so
 * a direct write is what the API itself would do.
 *
 * Needs `wrangler login` (or CLOUDFLARE_API_TOKEN) with R2 access.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cfToken, DEFAULT_ACCOUNT_ID } from '../release/cf-api.ts';
import { pairProfiles, planProfile, type StoredProfile } from './legacy-profiles.ts';

const BUCKETS = { qa: 'profiles-qa', stage: 'profiles-stage', production: 'profiles' } as const;
/** Auth service D1 (AlUmmahNowAuth apps/auth wrangler configs): users.email is the verified address */
const AUTH_DBS = { qa: '28590f3c-dd92-4c26-a803-d73a9bbe2b58', stage: 'c7886ef6-c70b-4b7f-a65b-3df9f9aba9e2', production: 'af76f007-e21e-43aa-88de-ebfefe46fb56' } as const;
type Env = keyof typeof BUCKETS;

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : undefined;
}

const env = arg('env') as Env | undefined;
if (!env || !(env in BUCKETS)) {
	console.error('Usage: backfill-legacy-profiles.ts --env qa|stage|production [--apply] [--backup-dir <dir>]');
	process.exit(2);
}
const apply = process.argv.includes('--apply');
const bucket = BUCKETS[env];
const token = cfToken();
if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID}/r2/buckets/${bucket}/objects`;
const auth = { Authorization: `Bearer ${token}` };

/** fetch with retries on rate limiting (429) and server errors; the CF API allows ~1200 requests / 5 min */
async function cfFetch(url: string, init: RequestInit = {}): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers as Record<string, string> | undefined) } });
		if ((res.status !== 429 && res.status < 500) || attempt >= 8) return res;
		const wait = Number(res.headers.get('retry-after')) * 1000 || Math.min(60000, 2000 * 2 ** attempt);
		await new Promise((r) => setTimeout(r, wait));
	}
}

async function listKeys(): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const res = await cfFetch(`${base}?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
		const json = (await res.json()) as { success: boolean; result: { key: string }[]; result_info?: { cursor?: string; is_truncated?: boolean } };
		if (!res.ok || !json.success) throw new Error(`list ${bucket}: HTTP ${res.status}`);
		keys.push(...json.result.map((o) => o.key));
		cursor = json.result_info?.is_truncated ? json.result_info.cursor : undefined;
	} while (cursor);
	return keys;
}

async function getRaw(key: string): Promise<string> {
	const res = await cfFetch(`${base}/${encodeURIComponent(key)}`);
	if (!res.ok) throw new Error(`get ${bucket}/${key}: HTTP ${res.status}`);
	return res.text();
}

async function put(key: string, profile: StoredProfile): Promise<void> {
	const res = await cfFetch(`${base}/${encodeURIComponent(key)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(profile),
	});
	if (!res.ok) throw new Error(`put ${bucket}/${key}: HTTP ${res.status}`);
}

/** Only profile keys: usr_ ids and legacy 32-hex ids (the bucket holds nothing else today). */
const keys = (await listKeys()).filter((k) => /^(usr_)?[0-9a-f]{32}$/.test(k));
const profiles: StoredProfile[] = [];
const BATCH = 4;
let unreadable = 0;
for (let i = 0; i < keys.length; i += BATCH) {
	const batch = await Promise.all(
		keys.slice(i, i + BATCH).map(async (key) => {
			const raw = await getRaw(key); // throws (aborting the run) if it cannot be read
			try {
				return { ...(JSON.parse(raw) as StoredProfile), id: key };
			} catch {
				unreadable++;
				console.warn(`not JSON, left alone: ${key}`);
				return null;
			}
		}),
	);
	profiles.push(...(batch.filter(Boolean) as StoredProfile[]));
	if (i && i % 200 === 0) console.error(`read ${i}/${keys.length}`);
}
if (unreadable) console.log(`${unreadable} object(s) were not JSON and were left alone`);

/** usr_ id → auth email (users.email in the auth service's D1), looked up only when legacy records exist */
async function authEmailsFor(ids: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID}/d1/database/${AUTH_DBS[env as Env]}/query`;
	for (let i = 0; i < ids.length; i += 50) {
		const chunk = ids.slice(i, i + 50);
		const res = await cfFetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sql: `SELECT id, email FROM users WHERE deleted_at IS NULL AND id IN (${chunk.map(() => '?').join(',')})`, params: chunk }),
		});
		const json = (await res.json()) as { success: boolean; result?: { results: { id: string; email: string }[] }[] };
		if (!res.ok || !json.success) throw new Error(`auth users query: HTTP ${res.status}`);
		for (const row of json.result?.[0]?.results ?? []) out.set(row.id, row.email);
	}
	return out;
}

// Every pairing is decided on the auth email of the usr_ id, never the profile's editable email
const legacyEmails = new Set(profiles.filter((p) => /^[0-9a-f]{32}$/.test(p.id)).map((p) => String(p.email ?? '').trim().toLowerCase()).filter(Boolean));
const candidates = profiles.filter((p) => p.id.startsWith('usr_') && legacyEmails.size).map((p) => p.id);
const authEmails = await authEmailsFor(candidates);
const { pairs, unmatched, ambiguous } = pairProfiles(profiles, authEmails);
const plans = pairs.map(({ current, legacy }) => ({ legacy, plan: planProfile(current, legacy) })).filter(({ plan }) => plan.changes.length);
const legacyCount = profiles.filter((p) => /^[0-9a-f]{32}$/.test(p.id)).length;

console.log(`${bucket}: ${profiles.length} profiles, ${legacyCount} legacy, ${pairs.filter((p) => p.legacy).length} paired, ${plans.length} to change`);
if (unmatched.length) console.log(`legacy records without a usr_ profile (left alone): ${unmatched.join(', ')}`);
if (ambiguous.length) console.log(`emails with several records (left alone): ${ambiguous.length}`);
for (const { plan } of plans) {
	console.log(`\n${plan.id}${plan.legacyId ? ` ← ${plan.legacyId}` : ''}`);
	for (const c of plan.changes) console.log(`  ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
}

if (!apply) {
	console.log(plans.length ? '\nDry run: nothing written. Re-run with --apply to write.' : '\nNothing to change.');
	process.exit(0);
}

const backupDir = arg('backup-dir') ?? join(tmpdir(), `profiles-backfill-${env}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(backupDir, { recursive: true });
let written = 0;
for (const { legacy, plan } of plans) {
	// Fresh copy: the user may have changed something since the read above
	const raw = await getRaw(plan.id);
	writeFileSync(join(backupDir, `${plan.id}.json`), raw);
	const fresh = planProfile({ ...(JSON.parse(raw) as StoredProfile), id: plan.id }, legacy);
	if (!fresh.changes.length) {
		console.log(`${plan.id}: nothing left to fill`);
		continue;
	}
	await put(plan.id, fresh.next);
	written++;
	console.log(`${plan.id}: wrote ${fresh.changes.map((c) => c.field).join(', ')}`);
}
console.log(`\nWrote ${written} profile(s). Backups (as they were before): ${backupDir}`);
