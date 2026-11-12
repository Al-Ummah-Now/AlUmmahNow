/**
 * Videos-side teardown of E2E run accounts (QA / stage only; 2026-11-11).
 *
 * Every CI E2E run registers its own accounts,
 * e2e+<run>-<attempt>-<name>@e2e.alummahnow.net, and deletes them on the auth
 * server when it ends (scripts/e2e/teardown-run-users.ts; the auth sweeper
 * removes what a killed runner left after 24 hours). That delete never reached
 * this service: the run accounts' profiles, channels and videos (with their
 * Bunny media) stayed. QA held 4,249 such profiles on 2026-11-11, mostly the
 * release specs' per-test accounts.
 *
 * Every 10 minutes (the processing-sweep cron) this finds run-account profiles
 * whose auth account is gone or deleted and erases them through the admin
 * path: soft delete (lib/admin/service.ts deleteUserData) and its purge at
 * once (purgeDeletionNow → the user.delete-data job: profile, channels,
 * videos with their Bunny videos, playlists, history, comments, likes and
 * subscriptions). Audited as actor "e2e-run-sweep".
 *
 * Only ever touches:
 * - a worker on a test library (BUNNY_TEST_LIBRARY="true") that is not
 *   production, with the auth D1 bound (read only);
 * - profiles whose indexed email matches RUN_USER_EMAIL (the auth server's and
 *   apps/web/e2e/test-utils/run-users.ts's rule): seed and real accounts never
 *   match;
 * - accounts the auth D1 has no live row for: a run still in progress keeps
 *   everything.
 */
import { pendingDeletion, purgeDeletionNow } from '../admin/deletions';
import { AdminError, deleteUserData, purgeDeletion, type AdminServiceEnv } from '../admin/service';
import { logger } from '../logger';

/** Same rule as the auth server's RUN_USER_EMAIL and apps/web/e2e/test-utils/run-users.ts. */
export const RUN_USER_EMAIL = /^e2e\+\d{1,20}-\d{1,3}-[a-z0-9][a-z0-9-]{0,62}@e2e\.alummahnow\.net$/;
export { RUN_USER_SWEEP_ACTOR } from '../privacy/run-user-erase';
import { RUN_USER_SWEEP_ACTOR } from '../privacy/run-user-erase';
export const RUN_USER_SWEEP_KEY = 'ops/run-user-sweep.json';
/** Profiles looked at per run (every 10 minutes). */
export const RUN_USER_SWEEP_LIMIT = 200;
const AUTH_BATCH = 50;
const CONCURRENCY = 5;

export function isRunUserEmail(email: unknown): email is string {
	return typeof email === 'string' && RUN_USER_EMAIL.test(email.toLowerCase());
}

type Db = {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
};

export type RunUserSweepEnv = AdminServiceEnv & {
	BUNNY_TEST_LIBRARY?: string;
	ENVIRONMENT?: string;
	SEARCH_DB?: unknown;
	AUTH_DB?: unknown;
	global_settings?: R2Bucket;
};

export interface RunUserSweepStats {
	at: string;
	candidates: number;
	live: number;
	erased: number;
	failed: number;
	durationMs: number;
}

/** Only a non-production worker on a test library, with both D1s bound. */
export function runUserSweepAllowed(env: Pick<RunUserSweepEnv, 'BUNNY_TEST_LIBRARY' | 'ENVIRONMENT' | 'SEARCH_DB' | 'AUTH_DB'>): boolean {
	return env.BUNNY_TEST_LIBRARY === 'true' && (env.ENVIRONMENT ?? '').toLowerCase() !== 'production' && !!env.SEARCH_DB && !!env.AUTH_DB;
}

/** Ids of the given users that still have a live (not deleted) auth account. */
async function liveAuthIds(auth: Db, ids: string[]): Promise<Set<string>> {
	const live = new Set<string>();
	for (let i = 0; i < ids.length; i += AUTH_BATCH) {
		const batch = ids.slice(i, i + AUTH_BATCH);
		const { results } = await auth
			.prepare(`SELECT id FROM users WHERE id IN (${batch.map(() => '?').join(', ')}) AND deleted_at IS NULL`)
			.bind(...batch)
			.all<{ id: string }>();
		for (const r of results ?? []) live.add(r.id);
	}
	return live;
}

/** Erases one run account's videos data: soft delete, then its purge now. */
export async function eraseRunUser(env: RunUserSweepEnv, userId: string, now = Date.now()): Promise<void> {
	const search = env.SEARCH_DB as never;
	if (!(await pendingDeletion(search, 'user', userId))) {
		try {
			await deleteUserData(env, userId, RUN_USER_SWEEP_ACTOR, 'E2E run account deleted on the auth server');
		} catch (error) {
			// Deleted meanwhile (another sweep, an admin): purge what is pending
			if (!(error instanceof AdminError && error.code === 'already_deleted')) throw error;
		}
	}
	await purgeDeletionNow(env as never, 'user', userId, RUN_USER_SWEEP_ACTOR, (d) => purgeDeletion(env, d), now);
}

/** One sweep (cron). Never throws; records its stats in global_settings. */
export async function sweepRunUsers(env: RunUserSweepEnv, opts: { now?: Date; limit?: number } = {}): Promise<RunUserSweepStats | null> {
	if (!runUserSweepAllowed(env)) return null;
	const started = Date.now();
	const now = opts.now ?? new Date();
	const stats: RunUserSweepStats = { at: now.toISOString(), candidates: 0, live: 0, erased: 0, failed: 0, durationMs: 0 };
	try {
		const search = env.SEARCH_DB as Db;
		// Profiles of run accounts not already handed to the deletion cleanup
		const { results } = await search
			.prepare(
				`SELECT id, email FROM content_ownership
				 WHERE kind = 'profile' AND email LIKE 'e2e+%@e2e.alummahnow.net'
				   AND id NOT IN (SELECT target_id FROM admin_deletions WHERE kind = 'user' AND (purge_started_at IS NOT NULL OR purged_at IS NOT NULL))
				 ORDER BY created_at LIMIT ?`,
			)
			.bind(opts.limit ?? RUN_USER_SWEEP_LIMIT)
			.all<{ id: string; email: string | null }>();
		const candidates = (results ?? []).filter((r) => typeof r.id === 'string' && r.id && isRunUserEmail(r.email));
		stats.candidates = candidates.length;
		if (candidates.length) {
			const live = await liveAuthIds(env.AUTH_DB as Db, candidates.map((c) => c.id));
			stats.live = live.size;
			const gone = candidates.filter((c) => !live.has(c.id));
			let cursor = 0;
			await Promise.all(
				Array.from({ length: Math.min(CONCURRENCY, gone.length) }, async () => {
					while (cursor < gone.length) {
						const { id } = gone[cursor++];
						try {
							await eraseRunUser(env, id, now.getTime());
							stats.erased++;
						} catch (error) {
							stats.failed++;
							logger.warn('[RunUserSweep] Erase failed; retried next run', { userId: id, error: error instanceof Error ? error.message : String(error) });
						}
					}
				}),
			);
		}
	} catch (error) {
		stats.failed++;
		logger.error('[RunUserSweep] Run failed', { error: error instanceof Error ? error.message : String(error) });
	}
	stats.durationMs = Date.now() - started;
	if (stats.candidates) logger.info('[RunUserSweep] Run finished', { ...stats });
	await env.global_settings
		?.put(RUN_USER_SWEEP_KEY, JSON.stringify(stats), { httpMetadata: { contentType: 'application/json' } })
		.catch(() => undefined);
	return stats;
}
