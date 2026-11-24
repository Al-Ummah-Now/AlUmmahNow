/**
 * Bounded one-time backfill for pre-existing `legacy-restore/` profile backups
 * in ADMIN_BACKUPS (api-videos lib/admin/legacy-restore.ts).
 *
 * Run ONLY after the pointer-index PR (#1902) is deployed to the target
 * environment, so no restore job on older code can write an unindexed copy
 * while this backfill runs (`--apply` requires `--confirm-1902-deployed`).
 *
 * Positive controls before any classification/deletion:
 *   1. List the environment's `profiles` bucket (`per_page=1`) and `HEAD` that
 *      existing profile key -> must return 200 (proves bucket/account/HEAD work
 *      and `profiles` is non-empty).
 *   2. Right before deleting an orphaned backup, `HEAD` the backup key itself ->
 *      must return 200 (proves HEAD and slash-segment encoding work on
 *      `ADMIN_BACKUPS`), and re-check `HEAD profiles/{profileId}` -> must still
 *      be 404.
 *   3. Any soft-deleted profile still exists in `profiles/{profileId}` (with
 *      `adminDeletion`), so `HEAD` returns 200 -> gets a pointer, never deleted.
 *   4. Deleting an orphaned backup also deletes its `by-user` pointer (404-tolerant)
 *      after the backup is removed.
 */
import { DEFAULT_ACCOUNT_ID } from '../release/cf-api.ts';

export const LEGACY_RESTORE_PREFIX = 'legacy-restore/';
export const LEGACY_RESTORE_POINTERS_PREFIX = `${LEGACY_RESTORE_PREFIX}by-user/`;

export const DEFAULT_MAX_PAGES = 10;
export const HARD_MAX_PAGES = 50;
export const DEFAULT_PER_PAGE = 1000;
export const HARD_MAX_PER_PAGE = 1000;
export const CF_FETCH_MAX_ATTEMPTS = 8;

export const ENVIRONMENTS = {
	qa: { backupsBucket: 'admin-backups-qa', profilesBucket: 'profiles-qa' },
	stage: { backupsBucket: 'admin-backups-stage', profilesBucket: 'profiles-stage' },
	production: { backupsBucket: 'admin-backups', profilesBucket: 'profiles' },
} as const;

export type TargetEnv = keyof typeof ENVIRONMENTS;

const BACKUP_KEY_PATTERN = /^legacy-restore\/([A-Za-z0-9_-]{1,128})\/(usr_[0-9a-f]{32})\/([A-Za-z0-9_-]{1,128})\.json$/;
const POINTER_KEY_PATTERN = /^legacy-restore\/by-user\/(usr_[0-9a-f]{32})\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/;

export type ParsedKey =
	| { kind: 'pointer'; key: string }
	| { kind: 'backup'; key: string; jobId: string; profileId: string; etag: string; pointerKey: string }
	| { kind: 'malformed'; key: string };

/** Strictly parses a key listed under `legacy-restore/`. */
export function parseLegacyRestoreKey(key: string): ParsedKey {
	if (key.startsWith(LEGACY_RESTORE_POINTERS_PREFIX)) {
		const match = POINTER_KEY_PATTERN.exec(key);
		if (!match || match[2] === 'by-user') return { kind: 'malformed', key };
		return { kind: 'pointer', key };
	}
	const match = BACKUP_KEY_PATTERN.exec(key);
	if (!match) return { kind: 'malformed', key };
	const [, jobId, profileId, etag] = match;
	if (jobId === 'by-user') return { kind: 'malformed', key };
	return {
		kind: 'backup',
		key,
		jobId,
		profileId,
		etag,
		pointerKey: `${LEGACY_RESTORE_POINTERS_PREFIX}${profileId}/${jobId}/${etag}`,
	};
}

/**
 * Encodes an R2 object key segment-by-segment for the Cloudflare R2 REST API
 * path (`/r2/buckets/{bucket}/objects/{key}`), preserving `/` separators
 * (matches `scripts/release/seed-translations.ts` and `upload-sourcemaps.ts`).
 */
export function encodeR2KeyPath(key: string): string {
	return key.split('/').map(encodeURIComponent).join('/');
}

export interface HttpDeps {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	maxAttempts?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Rate-limit aware Cloudflare REST fetch with retries on 429 and 5xx. */
export async function cfFetch(url: string, init: RequestInit, token: string, deps: HttpDeps = {}): Promise<Response> {
	const doFetch = deps.fetch ?? fetch;
	const doSleep = deps.sleep ?? defaultSleep;
	const maxAttempts = deps.maxAttempts ?? CF_FETCH_MAX_ATTEMPTS;
	const headers = { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) };

	for (let attempt = 0; ; attempt++) {
		const res = await doFetch(url, { ...init, headers });
		if ((res.status !== 429 && res.status < 500) || attempt >= maxAttempts) return res;
		const retryAfter = Number(res.headers.get('retry-after'));
		const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 2000 * 2 ** attempt);
		await doSleep(wait);
	}
}

export interface BackfillStore {
	listBackups(opts: { prefix: string; perPage: number; cursor?: string }): Promise<{ keys: string[]; cursor?: string; truncated: boolean }>;
	/** Sample up to 1 object key from the profiles bucket (positive control that bucket exists and is non-empty). */
	listProfilesSample(): Promise<string[]>;
	/** True when `profiles/{profileId}` exists (including soft-deleted profiles); false only on confirmed 404. */
	headProfile(profileId: string): Promise<boolean>;
	/** True when a key exists in ADMIN_BACKUPS; false only on confirmed 404. */
	headBackup(key: string): Promise<boolean>;
	putPointer(pointerKey: string): Promise<void>;
	/** Deletes a key in ADMIN_BACKUPS (404-tolerant). */
	deleteObject(key: string): Promise<void>;
}

/**
 * Cloudflare R2 REST client for a single environment's bucket pair.
 * Error messages omit object keys so user IDs are never printed to logs.
 */
export function createR2BackfillStore(opts: {
	env: TargetEnv;
	token: string;
	accountId?: string;
	deps?: HttpDeps;
}): BackfillStore {
	const accountId = opts.accountId || DEFAULT_ACCOUNT_ID;
	const { backupsBucket, profilesBucket } = ENVIRONMENTS[opts.env];
	const base = (bucket: string) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`;

	const headObject = async (bucket: string, key: string): Promise<boolean> => {
		const res = await cfFetch(`${base(bucket)}/${encodeR2KeyPath(key)}`, { method: 'HEAD' }, opts.token, opts.deps);
		if (res.status === 404) return false;
		if (!res.ok) throw new Error(`HEAD ${bucket}: HTTP ${res.status}`);
		return true;
	};

	const listObjects = async (bucket: string, params: URLSearchParams): Promise<{ keys: string[]; cursor?: string; truncated: boolean }> => {
		const res = await cfFetch(`${base(bucket)}?${params.toString()}`, { method: 'GET' }, opts.token, opts.deps);
		const json = (await res.json().catch(() => ({}))) as {
			success?: boolean;
			result?: { key: string }[];
			result_info?: { cursor?: string; is_truncated?: boolean };
			errors?: { code?: number; message?: string }[];
		};
		if (!res.ok || !json.success || !Array.isArray(json.result)) {
			const code = json.errors?.[0]?.code;
			throw new Error(`LIST ${bucket}: HTTP ${res.status}${code !== undefined ? ` (code ${code})` : ''}`);
		}
		return {
			keys: json.result.map((o) => o.key),
			truncated: Boolean(json.result_info?.is_truncated),
			cursor: json.result_info?.cursor,
		};
	};

	return {
		listBackups: ({ prefix, perPage, cursor }) => {
			const params = new URLSearchParams({ prefix, per_page: String(perPage) });
			if (cursor) params.set('cursor', cursor);
			return listObjects(backupsBucket, params);
		},
		listProfilesSample: async () => {
			const page = await listObjects(profilesBucket, new URLSearchParams({ per_page: '1' }));
			return page.keys;
		},
		headProfile: (profileId) => headObject(profilesBucket, profileId),
		headBackup: (key) => headObject(backupsBucket, key),
		putPointer: async (pointerKey) => {
			const res = await cfFetch(
				`${base(backupsBucket)}/${encodeR2KeyPath(pointerKey)}`,
				{ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '' },
				opts.token,
				opts.deps,
			);
			if (!res.ok) throw new Error(`PUT ${backupsBucket}: HTTP ${res.status}`);
		},
		deleteObject: async (key) => {
			const res = await cfFetch(`${base(backupsBucket)}/${encodeR2KeyPath(key)}`, { method: 'DELETE' }, opts.token, opts.deps);
			if (!res.ok && res.status !== 404) throw new Error(`DELETE ${backupsBucket}: HTTP ${res.status}`);
		},
	};
}

export interface BackfillOptions {
	dryRun: boolean;
	cursor?: string;
	maxPages?: number;
	perPage?: number;
}

export interface BackfillReport {
	dryRun: boolean;
	pagesProcessed: number;
	scanned: number;
	existingPointers: number;
	alreadyIndexed: number;
	pointersToCreate: number;
	pointersCreated: number;
	orphanedToDelete: number;
	orphanedDeleted: number;
	/** Copies initially seen as orphaned whose profile existed on the pre-delete re-check (indexed instead of deleted). */
	raceRecheckedAlive: number;
	skippedMalformed: number;
	distinctUsers: number;
	complete: boolean;
	nextCursor: string | null;
}

export function validateBounds(maxPages: number, perPage: number): void {
	if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > HARD_MAX_PAGES) {
		throw new Error(`--max-pages must be an integer between 1 and ${HARD_MAX_PAGES} (got ${maxPages})`);
	}
	if (!Number.isInteger(perPage) || perPage < 1 || perPage > HARD_MAX_PER_PAGE) {
		throw new Error(`--per-page must be an integer between 1 and ${HARD_MAX_PER_PAGE} (got ${perPage})`);
	}
}

export interface ParsedCliArgs {
	env: TargetEnv;
	apply: boolean;
	confirm1902Deployed: boolean;
	cursor?: string;
	cursorFile?: string;
	maxPages: number;
	perPage: number;
}

/** Public-safe summary printed to stdout: omits the raw R2 list cursor (which may encode a user ID). */
export function formatCliReport(
	meta: { env: TargetEnv; backupsBucket: string; profilesBucket: string; cursorFile: string | null },
	report: BackfillReport,
): Record<string, unknown> {
	const { nextCursor: _omitted, ...counts } = report;
	return {
		...meta,
		...counts,
		hasMore: !report.complete,
	};
}

/** Parses and validates CLI flags: requires one environment, dry-run by default, bounded pages, deploy confirmation on --apply. */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
	let env: TargetEnv | undefined;
	let apply = false;
	let confirm1902Deployed = false;
	let cursor: string | undefined;
	let cursorFile: string | undefined;
	let maxPages = DEFAULT_MAX_PAGES;
	let perPage = DEFAULT_PER_PAGE;

	const valueAfter = (flag: string, i: number): string => {
		const v = argv[i + 1];
		if (!v || v.startsWith('--')) throw new Error(`Missing value for ${flag}`);
		return v;
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--env') {
			if (env !== undefined) throw new Error('Specify only one --env per run');
			const val = valueAfter('--env', i++);
			if (!(val in ENVIRONMENTS)) throw new Error(`Unknown --env "${val}": expected qa, stage, or production`);
			env = val as TargetEnv;
		} else if (arg === '--apply') {
			apply = true;
		} else if (arg === '--confirm-1902-deployed') {
			confirm1902Deployed = true;
		} else if (arg === '--cursor') {
			cursor = valueAfter('--cursor', i++);
		} else if (arg === '--cursor-file') {
			cursorFile = valueAfter('--cursor-file', i++);
		} else if (arg === '--max-pages') {
			maxPages = Number(valueAfter('--max-pages', i++));
		} else if (arg === '--per-page') {
			perPage = Number(valueAfter('--per-page', i++));
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!env) throw new Error('Missing required --env qa|stage|production');
	if (cursor && cursorFile) throw new Error('Pass either --cursor or --cursor-file, not both');
	if (apply && !confirm1902Deployed) {
		throw new Error('--apply requires --confirm-1902-deployed (confirm #1902 is deployed to this environment first)');
	}
	validateBounds(maxPages, perPage);
	return { env, apply, confirm1902Deployed, cursor, cursorFile, maxPages, perPage };
}

/**
 * Runs one bounded, resumable backfill pass over `legacy-restore/` for a single environment.
 * Dry-run (`dryRun: true`) performs reads only and writes/deletes nothing.
 */
export async function backfillLegacyRestorePointers(store: BackfillStore, opts: BackfillOptions): Promise<BackfillReport> {
	const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
	const perPage = opts.perPage ?? DEFAULT_PER_PAGE;
	validateBounds(maxPages, perPage);

	const report: BackfillReport = {
		dryRun: opts.dryRun,
		pagesProcessed: 0,
		scanned: 0,
		existingPointers: 0,
		alreadyIndexed: 0,
		pointersToCreate: 0,
		pointersCreated: 0,
		orphanedToDelete: 0,
		orphanedDeleted: 0,
		raceRecheckedAlive: 0,
		skippedMalformed: 0,
		distinctUsers: 0,
		complete: false,
		nextCursor: null,
	};

	const users = new Set<string>();
	let profilesVerified = false;
	const ensureProfilesBucketPositiveControl = async () => {
		if (profilesVerified) return;
		const sample = await store.listProfilesSample();
		if (!sample.length) {
			throw new Error('Positive control failed: profiles bucket is empty or unreachable; aborting');
		}
		if (!(await store.headProfile(sample[0]))) {
			throw new Error('Positive control failed: HEAD on an existing profile returned 404; aborting');
		}
		profilesVerified = true;
	};

	let cursor = opts.cursor;
	let hasMore = true;

	while (hasMore && report.pagesProcessed < maxPages) {
		const page = await store.listBackups({ prefix: LEGACY_RESTORE_PREFIX, perPage, cursor });
		report.pagesProcessed++;
		report.scanned += page.keys.length;

		for (const key of page.keys) {
			const parsed = parseLegacyRestoreKey(key);
			if (parsed.kind === 'pointer') {
				report.existingPointers++;
				continue;
			}
			if (parsed.kind === 'malformed') {
				report.skippedMalformed++;
				continue;
			}

			await ensureProfilesBucketPositiveControl();
			users.add(parsed.profileId);

			const profileExists = await store.headProfile(parsed.profileId);
			if (profileExists) {
				const pointerExists = await store.headBackup(parsed.pointerKey);
				if (pointerExists) {
					report.alreadyIndexed++;
				} else {
					report.pointersToCreate++;
					if (!opts.dryRun) {
						await store.putPointer(parsed.pointerKey);
						report.pointersCreated++;
					}
				}
				continue;
			}

			// Positive control on the backup object itself: HEAD must return 200 (proves HEAD
			// and key encoding work for ADMIN_BACKUPS before any orphan classification/delete).
			if (!(await store.headBackup(parsed.key))) {
				throw new Error('Positive control failed: HEAD on listed backup object returned 404; aborting');
			}

			if (opts.dryRun) {
				report.orphanedToDelete++;
				continue;
			}

			// Re-check HEAD profiles/{profileId} right before deleting so a profile that appeared
			// concurrently (or a soft-deleted profile still present) is never deleted.
			const stillAbsent = !(await store.headProfile(parsed.profileId));
			if (!stillAbsent) {
				report.raceRecheckedAlive++;
				if (!(await store.headBackup(parsed.pointerKey))) {
					await store.putPointer(parsed.pointerKey);
					report.pointersCreated++;
				} else {
					report.alreadyIndexed++;
				}
				continue;
			}
			report.orphanedToDelete++;
			// Delete backup first, then any leftover pointer (404-tolerant)
			await store.deleteObject(parsed.key);
			await store.deleteObject(parsed.pointerKey);
			report.orphanedDeleted++;
		}

		hasMore = page.truncated && Boolean(page.cursor);
		cursor = hasMore ? page.cursor : undefined;
	}

	report.distinctUsers = users.size;
	report.complete = !hasMore;
	report.nextCursor = hasMore ? (cursor ?? null) : null;
	return report;
}
