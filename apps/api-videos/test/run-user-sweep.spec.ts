/**
 * 2026-11-11: E2E run accounts deleted on the auth server kept their videos
 * data (profile, channels, videos with Bunny media). The QA/stage sweep
 * erases it once the auth account is gone (lib/e2e/runUserSweep.ts).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRunUserEmail, RUN_USER_SWEEP_ACTOR, runUserSweepAllowed, sweepRunUsers } from '../src/lib/e2e/runUserSweep';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

class JobQueue {
	sent: any[] = [];
	async send(body: unknown) {
		this.sent.push(body);
	}
	async sendBatch(messages: { body: unknown }[]) {
		for (const m of messages) this.sent.push(m.body);
	}
}

/** Auth D1 stub: answers the live-account query from a set of live ids. */
function authDb(live: Set<string>) {
	const queries: unknown[][] = [];
	return {
		queries,
		prepare(sql: string) {
			return {
				bind(...values: unknown[]) {
					return {
						async all<T>() {
							assert.match(sql, /FROM users WHERE id IN/);
							assert.match(sql, /deleted_at IS NULL/);
							queries.push(values);
							return { results: values.filter((v) => live.has(String(v))).map((id) => ({ id })) as T[] };
						},
					};
				},
			};
		},
	};
}

async function seedProfile(db: SqliteD1, id: string, email: string, createdAt: number) {
	await db
		.prepare("INSERT INTO content_ownership (kind, id, owner_id, email, created_at) VALUES ('profile', ?, ?, ?, ?)")
		.bind(id, id, email, createdAt)
		.run();
}

function env(overrides: Record<string, unknown> = {}) {
	return {
		SEARCH_DB: new SqliteD1(),
		AUTH_DB: authDb(new Set()),
		ADMIN_JOBS_QUEUE: new JobQueue(),
		profiles: new MemoryBucket(),
		channels: new MemoryBucket(),
		videos: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new JobQueue(),
		BUNNY_TEST_LIBRARY: 'true',
		ENVIRONMENT: 'qa',
		...overrides,
	} as any;
}

describe('E2E run-account sweep (videos side)', () => {
	it('matches only run-account addresses (the auth server rule)', () => {
		assert.equal(isRunUserEmail('e2e+43061072862-1-rel-mwb5k16b0wli-rel-cat-en@e2e.alummahnow.net'), true);
		assert.equal(isRunUserEmail('e2e+1-1-web-chromium-single@e2e.alummahnow.net'), true);
		// Seed, release sign-ups without the run prefix, real users, look-alikes
		for (const e of ['qa-creator@delivered.resend.dev', 'rel-history-1794124057313-pr4jgp@e2e.alummahnow.net', 'e2e+seed@e2e.alummahnow.net', 'e2e+1-1-x@e2e.alummahnow.net.evil.com', 'user@gmail.com', null, undefined]) {
			assert.equal(isRunUserEmail(e as never), false, String(e));
		}
	});

	it('runs only on a non-production test-library worker with both D1s', () => {
		assert.equal(runUserSweepAllowed(env()), true);
		assert.equal(runUserSweepAllowed(env({ ENVIRONMENT: 'production' })), false);
		assert.equal(runUserSweepAllowed(env({ BUNNY_TEST_LIBRARY: 'false' })), false);
		assert.equal(runUserSweepAllowed(env({ AUTH_DB: undefined })), false);
	});

	it('erases run accounts whose auth account is gone; keeps live run accounts and every other profile', async () => {
		const e = env();
		const gone = ['usr_gone1', 'usr_gone2'];
		await seedProfile(e.SEARCH_DB, gone[0], 'e2e+42897060354-1-rel-a-rel-cat-en@e2e.alummahnow.net', 1);
		await seedProfile(e.SEARCH_DB, gone[1], 'e2e+42897060354-1-web-chromium-single@e2e.alummahnow.net', 2);
		await seedProfile(e.SEARCH_DB, 'usr_live', 'e2e+43069429574-1-rel-b@e2e.alummahnow.net', 3);
		await seedProfile(e.SEARCH_DB, 'usr_seed', 'qa-creator@delivered.resend.dev', 4);
		await seedProfile(e.SEARCH_DB, 'usr_rel', 'rel-history-1794124057313-pr4jgp@e2e.alummahnow.net', 5);
		e.AUTH_DB = authDb(new Set(['usr_live']));

		const stats = await sweepRunUsers(e);
		assert.deepEqual({ candidates: stats?.candidates, live: stats?.live, erased: stats?.erased, failed: stats?.failed }, { candidates: 3, live: 1, erased: 2, failed: 0 });
		// The auth D1 was only ever asked about run accounts
		assert.deepEqual(e.AUTH_DB.queries.flat().sort(), ['usr_gone1', 'usr_gone2', 'usr_live']);

		const { results } = await e.SEARCH_DB.prepare("SELECT target_id, deleted_by, purge_requested_at IS NOT NULL AS queued, purge_started_at IS NOT NULL AS started FROM admin_deletions WHERE kind = 'user' ORDER BY target_id").all();
		assert.deepEqual(
			results.map((r: any) => [r.target_id, r.deleted_by, r.queued, r.started]),
			gone.map((id) => [id, RUN_USER_SWEEP_ACTOR, 1, 1]),
		);
		// The purge job is queued for each: the cheap, index-based run-account erasure (#887), not user.delete-data's bucket scans
		const jobs = (await e.SEARCH_DB.prepare("SELECT kind, target_id FROM admin_jobs WHERE kind = 'user.erase-run' ORDER BY target_id").all()).results;
		assert.deepEqual(jobs.map((j: any) => j.target_id), gone);

		// Next run: the started purges are not picked again
		const again = await sweepRunUsers(e);
		assert.equal(again?.candidates, 1);
		assert.equal(again?.erased, 0);
		assert.ok(await e.global_settings.get('ops/run-user-sweep.json'));
	});

	it('does nothing on production', async () => {
		const e = env({ ENVIRONMENT: 'production' });
		await seedProfile(e.SEARCH_DB, 'usr_gone', 'e2e+1-1-rel-a@e2e.alummahnow.net', 1);
		assert.equal(await sweepRunUsers(e), null);
		assert.equal(e.ADMIN_JOBS_QUEUE.sent.length, 0);
	});
});
