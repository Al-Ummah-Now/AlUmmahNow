/**
 * Bounded one-time backfill for pre-existing `legacy-restore/` profile backups
 * in ADMIN_BACKUPS (api-videos lib/admin/legacy-restore.ts).
 *
 * Run ONLY after the pointer-index PR (#1902) is deployed to the target
 * environment, so no restore job on older code can write an unindexed copy
 * while this backfill runs.
 *
 * For each object under `legacy-restore/`:
 *   - `legacy-restore/by-user/...` is skipped (already a pointer).
 *   - Strictly parsed `legacy-restore/{jobId}/{profileId}/{etag}.json`:
 *     - If `profiles/{profileId}` exists (including soft-deleted profiles with
 *       `adminDeletion`), ensure pointer `legacy-restore/by-user/{profileId}/{jobId}/{etag}`
 *       exists (never deletes the backup).
 *     - If `profiles/{profileId}` is absent, re-check with HEAD right before
 *       deleting (under `--apply`), and only delete if still absent; if a
 *       profile appeared in the meantime, write the pointer instead of deleting.
 *   - Any key that does not match the strict layout is skipped and reported,
 *     never modified or deleted.
 */

export const LEGACY_RESTORE_PREFIX = 'legacy-restore/';
export const LEGACY_RESTORE_POINTERS_PREFIX = `${LEGACY_RESTORE_PREFIX}by-user/`;

export const DEFAULT_MAX_PAGES = 10;
export const HARD_MAX_PAGES = 50;
export const DEFAULT_PER_PAGE = 1000;
export const HARD_MAX_PER_PAGE = 1000;

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

export interface BackfillStore {
	listBackups(opts: { prefix: string; perPage: number; cursor?: string }): Promise<{ keys: string[]; cursor?: string; truncated: boolean }>;
	/** True when `profiles/{profileId}` exists (including soft-deleted profiles); false only on confirmed 404. */
	headProfile(profileId: string): Promise<boolean>;
	/** True when a key exists in ADMIN_BACKUPS; false only on confirmed 404. */
	headBackup(key: string): Promise<boolean>;
	putPointer(pointerKey: string): Promise<void>;
	deleteBackup(backupKey: string): Promise<void>;
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
	malformedKeys: string[];
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
	cursor?: string;
	maxPages: number;
	perPage: number;
}

/** Parses and validates CLI flags: requires one environment, dry-run by default, bounded pages. */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
	let env: TargetEnv | undefined;
	let apply = false;
	let cursor: string | undefined;
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
		} else if (arg === '--cursor') {
			cursor = valueAfter('--cursor', i++);
		} else if (arg === '--max-pages') {
			maxPages = Number(valueAfter('--max-pages', i++));
		} else if (arg === '--per-page') {
			perPage = Number(valueAfter('--per-page', i++));
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!env) throw new Error('Missing required --env qa|stage|production');
	validateBounds(maxPages, perPage);
	return { env, apply, cursor, maxPages, perPage };
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
		malformedKeys: [],
		distinctUsers: 0,
		complete: false,
		nextCursor: null,
	};

	const users = new Set<string>();
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
				if (report.malformedKeys.length < 50) report.malformedKeys.push(key);
				continue;
			}

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

			// Profile absent: on apply, re-check HEAD right before deleting so a concurrent
			// profile creation (or soft-deleted profile still present) is never deleted.
			if (opts.dryRun) {
				report.orphanedToDelete++;
				continue;
			}
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
			await store.deleteBackup(parsed.key);
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
