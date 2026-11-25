import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import { CREATOR_ERROR_CODES, CURRENT_CREATOR_TERMS_VERSION, forgetFeatureSwitches } from '@al-ummah/shared-types';
import {
	eraseCreatorTermsAcceptance,
	hasAcceptedCreatorTerms,
	readCreatorTermsAcceptance,
	recordCreatorTermsAcceptance,
} from '../src/lib/creatorTerms';
import { channelCreateGate, creatorAccess, handleAcceptCreatorTerms } from '../src/endpoints/creator/creatorAccess';
import { enforceCreatorTerms } from '../src/middleware/upload-limits';
import { collectUserData, eraseUserData } from '../src/lib/privacy/user-data';
import { eraseRunUserData } from '../src/lib/privacy/run-user-erase';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { OperationBudget } from '../src/lib/privacy/scan';
import { recordDeletion } from '../src/lib/admin/deletions';
import { MemoryBucket, MemoryQueue } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

function enableCreatorTermsSwitch(sqlite: SqliteD1, enabled: boolean) {
	sqlite.db
		.prepare(
			`INSERT OR REPLACE INTO feature_switches (key, enabled, version, updated_by, updated_at)
			 VALUES ('creatorTerms', ?, 1, 'test', '2026-11-24T00:00:00Z')`,
		)
		.run(enabled ? 1 : 0);
	forgetFeatureSwitches();
}

describe('creatorTerms (real SQLite D1)', () => {
	beforeEach(() => {
		forgetFeatureSwitches();
	});

	it('returns null / false when user has not accepted terms yet', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		assert.equal(await readCreatorTermsAcceptance(db, 'user-1'), null);
		assert.equal(await hasAcceptedCreatorTerms(db, 'user-1'), false);
	});

	it('records acceptance by user_id PK and preserves first accepted_at on same-version re-POST against real SQL', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const first = '2026-11-24T12:00:00.000Z';
		const later = '2026-11-25T09:00:00.000Z';
		const saved = await recordCreatorTermsAcceptance(db, 'user-1', CURRENT_CREATOR_TERMS_VERSION, first);
		assert.deepEqual(saved, { termsVersion: CURRENT_CREATOR_TERMS_VERSION, acceptedAt: first });
		assert.equal(await hasAcceptedCreatorTerms(db, 'user-1'), true);

		// Real SQLite ON CONFLICT ... WHERE terms_version <> excluded.terms_version keeps the first timestamp
		const repeated = await recordCreatorTermsAcceptance(db, 'user-1', CURRENT_CREATOR_TERMS_VERSION, later);
		assert.deepEqual(repeated, { termsVersion: CURRENT_CREATOR_TERMS_VERSION, acceptedAt: first });

		// Updating to a newer Terms version records the new version and timestamp
		const upgraded = await recordCreatorTermsAcceptance(db, 'user-1', '2027-01-01', later);
		assert.deepEqual(upgraded, { termsVersion: '2027-01-01', acceptedAt: later });
		assert.equal(await hasAcceptedCreatorTerms(db, 'user-1', CURRENT_CREATOR_TERMS_VERSION), false);

		// An older version during a rolling deploy/rollback MUST NOT overwrite a newer stored version
		const downgraded = await recordCreatorTermsAcceptance(db, 'user-1', '2025-01-01', '2027-01-02T00:00:00.000Z');
		assert.deepEqual(downgraded, { termsVersion: '2027-01-01', acceptedAt: later });
	});

	it('erases and exports the creator_terms_acceptances row in eraseUserData, collectUserData, and eraseRunUserData', async () => {
		const makePrivacyEnv = () => {
			const sqlite = new SqliteD1();
			return {
				sqlite,
				env: {
					SEARCH_DB: sqlite,
					profiles: new MemoryBucket(),
					channels: new MemoryBucket(),
					channel_sections: new MemoryBucket(),
					channel_tabs: new MemoryBucket(),
					videos: new MemoryBucket(),
					watch_history: new MemoryBucket(),
					community_posts: new MemoryBucket(),
					playlists: new MemoryBucket(),
					'upload-defaults': new MemoryBucket(),
					reports: new MemoryBucket(),
					subtitles: new MemoryBucket(),
					global_settings: new MemoryBucket(),
					queue: new MemoryQueue(),
				} as any,
			};
		};

		// 1. Export + self-service resumable eraseUserData
		const a = makePrivacyEnv();
		await recordCreatorTermsAcceptance(a.sqlite as unknown as D1Database, 'user-p', CURRENT_CREATOR_TERMS_VERSION, '2026-11-24T12:00:00.000Z');
		const exported = await collectUserData(a.env, 'user-p', new OperationBudget(200));
		assert.deepEqual(exported.creatorTermsAcceptance, {
			termsVersion: CURRENT_CREATOR_TERMS_VERSION,
			acceptedAt: '2026-11-24T12:00:00.000Z',
		});

		let token: string | undefined;
		let complete = false;
		for (let i = 0; i < 40 && !complete; i++) {
			const res = await eraseUserData(a.env, 'user-p', new OperationBudget(200), {}, { resumeToken: token, pageSize: 2 });
			complete = res.complete;
			token = res.resumeToken;
		}
		assert.equal(complete, true);
		assert.equal(await readCreatorTermsAcceptance(a.sqlite as unknown as D1Database, 'user-p'), null);

		// 2. Run-account eraseRunUserData
		const b = makePrivacyEnv();
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(b.env, kind, { maxPages: 10 });
		await recordCreatorTermsAcceptance(b.sqlite as unknown as D1Database, 'user-r', CURRENT_CREATOR_TERMS_VERSION, '2026-11-24T12:00:00.000Z');
		const runRes = await eraseRunUserData(b.env, 'user-r', new OperationBudget(500));
		assert.equal(runRes.complete, true);
		assert.equal(await readCreatorTermsAcceptance(b.sqlite as unknown as D1Database, 'user-r'), null);
	});

	it('handleAcceptCreatorTerms refuses pending-deletion accounts and does not recreate the row', async () => {
		const sqlite = new SqliteD1();
		const db = sqlite as unknown as D1Database;
		await recordDeletion(sqlite as never, { kind: 'user', id: 'user-del', deletedBy: 'admin' });
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('userId' as never, 'user-del' as never);
			await next();
		});
		app.post('/api/me/creator/terms', handleAcceptCreatorTerms);
		const res = await app.request(
			'/api/me/creator/terms',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ version: CURRENT_CREATOR_TERMS_VERSION }),
			},
			{ SEARCH_DB: db },
		);
		assert.equal(res.status, 403);
		assert.equal(((await res.json()) as { code: string }).code, 'videos_account_pending_deletion');
		assert.equal(await readCreatorTermsAcceptance(db, 'user-del'), null);
	});

	it('erases the user row on privacy erasure', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		await recordCreatorTermsAcceptance(db, 'user-1', CURRENT_CREATOR_TERMS_VERSION, '2026-11-24T12:00:00.000Z');
		assert.equal(await eraseCreatorTermsAcceptance(db, 'user-1'), 1);
		assert.equal(await readCreatorTermsAcceptance(db, 'user-1'), null);
	});

	it('POST /api/me/creator/terms checks auth, requires current version (409 on missing/non-JSON/malformed/stale), and stores acceptance', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const app = new Hono();
		app.use('*', async (c, next) => {
			const user = c.req.header('x-user');
			if (user) c.set('userId' as never, user as never);
			await next();
		});
		app.post('/api/me/creator/terms', handleAcceptCreatorTerms);

		const unauth = await app.request('/api/me/creator/terms', { method: 'POST' }, { SEARCH_DB: db });
		assert.equal(unauth.status, 401);

		const expect409 = async (res: Response, label: string) => {
			assert.equal(res.status, 409, `${label}: expected 409`);
			const b = (await res.json()) as { code: string; currentVersion: string };
			assert.equal(b.code, CREATOR_ERROR_CODES.termsVersionChanged, `${label}: expected terms_version_changed`);
			assert.equal(b.currentVersion, CURRENT_CREATOR_TERMS_VERSION, `${label}: expected currentVersion`);
			assert.equal(await hasAcceptedCreatorTerms(db, 'user-42'), false, `${label}: must not record acceptance`);
		};

		// Missing body / no content-type
		await expect409(
			await app.request('/api/me/creator/terms', { method: 'POST', headers: { 'x-user': 'user-42' } }, { SEARCH_DB: db }),
			'missing body',
		);
		// Non-JSON content-type
		await expect409(
			await app.request(
				'/api/me/creator/terms',
				{ method: 'POST', headers: { 'x-user': 'user-42', 'content-type': 'text/plain' }, body: CURRENT_CREATOR_TERMS_VERSION },
				{ SEARCH_DB: db },
			),
			'non-json content-type',
		);
		// Malformed JSON
		await expect409(
			await app.request(
				'/api/me/creator/terms',
				{ method: 'POST', headers: { 'x-user': 'user-42', 'content-type': 'application/json' }, body: '{bad json' },
				{ SEARCH_DB: db },
			),
			'malformed json',
		);
		// Empty object (version omitted)
		await expect409(
			await app.request(
				'/api/me/creator/terms',
				{ method: 'POST', headers: { 'x-user': 'user-42', 'content-type': 'application/json' }, body: '{}' },
				{ SEARCH_DB: db },
			),
			'omitted version',
		);
		// Non-string version
		await expect409(
			await app.request(
				'/api/me/creator/terms',
				{ method: 'POST', headers: { 'x-user': 'user-42', 'content-type': 'application/json' }, body: JSON.stringify({ version: 20261124 }) },
				{ SEARCH_DB: db },
			),
			'non-string version',
		);
		// Stale version
		await expect409(
			await app.request(
				'/api/me/creator/terms',
				{
					method: 'POST',
					headers: { 'x-user': 'user-42', 'content-type': 'application/json' },
					body: JSON.stringify({ version: '2025-01-01' }),
				},
				{ SEARCH_DB: db },
			),
			'stale version',
		);

		const ok = await app.request(
			'/api/me/creator/terms',
			{
				method: 'POST',
				headers: { 'x-user': 'user-42', 'content-type': 'application/json' },
				body: JSON.stringify({ version: CURRENT_CREATOR_TERMS_VERSION }),
			},
			{ SEARCH_DB: db },
		);
		assert.equal(ok.status, 200);
		const body = (await ok.json()) as { success: boolean; result: { termsAccepted: boolean; termsVersion: string; termsAcceptedAt: string } };
		assert.equal(body.success, true);
		assert.equal(body.result.termsAccepted, true);
		assert.equal(body.result.termsVersion, CURRENT_CREATOR_TERMS_VERSION);
		assert.equal(await hasAcceptedCreatorTerms(db, 'user-42'), true);

		// Contract (Core#61 / Android #72): HTTP 409 on POST /api/me/creator/terms is reserved exclusively for
		// terms_version_changed. Other failures (auth, D1 unavailability) must never return 409.
		const brokenDb = {
			prepare: () => {
				throw new Error('D1 unavailable');
			},
		} as unknown as D1Database;
		const dbErr = await app.request(
			'/api/me/creator/terms',
			{
				method: 'POST',
				headers: { 'x-user': 'user-42', 'content-type': 'application/json' },
				body: JSON.stringify({ version: CURRENT_CREATOR_TERMS_VERSION }),
			},
			{ SEARCH_DB: brokenDb },
		);
		assert.equal(dbErr.status, 503, 'D1 failure returns 503, never 409');
	});

	it('enforceCreatorTerms and channelCreateGate handle on -> off -> on and fail closed (503) on switch or D1 errors', async () => {
		const sqlite = new SqliteD1();
		const db = sqlite as unknown as D1Database;
		const app = new Hono();
		app.use('*', async (c, next) => {
			const user = c.req.header('x-user');
			if (user) c.set('userId' as never, user as never);
			const role = c.req.header('x-role');
			if (role) c.set('auth' as never, { payload: { roles: [role] } } as never);
			await next();
		});
		app.post('/gated', async (c) => {
			const refused = await enforceCreatorTerms(c, c.get('userId' as never) as string);
			if (refused) return refused;
			return c.json({ ok: true });
		});
		app.post('/api/channels', channelCreateGate, (c) => c.json({ success: true, result: { channel: { id: 'ch-1' } } }));

		// Give user-7 a creator tier so channelCreateGate reaches the terms check
		sqlite.db
			.prepare(
				`INSERT OR REPLACE INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at)
				 VALUES ('user-7', 'creator', 'admin', 'test', '2026-11-24T00:00:00Z')`,
			)
			.run();

		// 1. On: unaccepted user & super admin are both refused with 403 terms_required
		enableCreatorTermsSwitch(sqlite, true);
		const onUser = await app.request('/gated', { method: 'POST', headers: { 'x-user': 'user-7' } }, { SEARCH_DB: db });
		assert.equal(onUser.status, 403);
		assert.equal(((await onUser.json()) as { code: string }).code, CREATOR_ERROR_CODES.termsRequired);

		const onSuperAdmin = await app.request(
			'/api/channels',
			{ method: 'POST', headers: { 'x-user': 'admin-1', 'x-role': 'Super Admin' } },
			{ SEARCH_DB: db },
		);
		assert.equal(onSuperAdmin.status, 403, 'super admin must accept creator terms when creating a channel');

		// 2. Off: both pass immediately
		enableCreatorTermsSwitch(sqlite, false);
		assert.equal((await app.request('/gated', { method: 'POST', headers: { 'x-user': 'user-7' } }, { SEARCH_DB: db })).status, 200);
		assert.equal((await app.request('/api/channels', { method: 'POST', headers: { 'x-user': 'user-7' } }, { SEARCH_DB: db })).status, 200);

		// 3. Back on: enforced again
		enableCreatorTermsSwitch(sqlite, true);
		assert.equal((await app.request('/gated', { method: 'POST', headers: { 'x-user': 'user-7' } }, { SEARCH_DB: db })).status, 403);
		assert.equal((await app.request('/api/channels', { method: 'POST', headers: { 'x-user': 'user-7' } }, { SEARCH_DB: db })).status, 403);

		// 4. Broken creator_terms_acceptances fails closed with 503 in both enforceCreatorTerms and channelCreateGate
		sqlite.db.exec('DROP TABLE creator_terms_acceptances');
		assert.equal((await app.request('/gated', { method: 'POST', headers: { 'x-user': 'user-7' } }, { SEARCH_DB: db })).status, 503);
		assert.equal((await app.request('/api/channels', { method: 'POST', headers: { 'x-user': 'user-7' } }, { SEARCH_DB: db })).status, 503);

		// 5. Broken feature_switches read fails closed with 503 (never silently opens the gate)
		const brokenDb = {
			prepare: () => {
				throw new Error('D1 unreachable');
			},
		} as unknown as D1Database;
		forgetFeatureSwitches();
		assert.equal((await app.request('/gated', { method: 'POST', headers: { 'x-user': 'user-7' } }, { SEARCH_DB: brokenDb })).status, 503);
	});

	it('creatorAccess omits termsAccepted while creatorTerms switch is off, includes it when on, and stays resilient if the terms table fails', async () => {
		const sqlite = new SqliteD1();
		const db = sqlite as unknown as D1Database;

		// Default switch (off): termsAccepted omitted so old and new clients see no gate
		const offAccess = await creatorAccess(db, 'user-9', undefined, { SEARCH_DB: db });
		assert.equal(offAccess.termsAccepted, undefined);
		assert.equal(offAccess.termsVersion, undefined);

		// Switch on: termsAccepted returned
		enableCreatorTermsSwitch(sqlite, true);
		const onBefore = await creatorAccess(db, 'user-9', undefined, { SEARCH_DB: db });
		assert.equal(onBefore.termsAccepted, false);
		assert.equal(onBefore.termsVersion, CURRENT_CREATOR_TERMS_VERSION);

		await recordCreatorTermsAcceptance(db, 'user-9');
		const onAfter = await creatorAccess(db, 'user-9', undefined, { SEARCH_DB: db });
		assert.equal(onAfter.termsAccepted, true);

		// Missing/broken creator_terms_acceptances table must NOT 503 GET /api/me/creator
		sqlite.db.exec('DROP TABLE creator_terms_acceptances');
		const degraded = await creatorAccess(db, 'user-9', undefined, { SEARCH_DB: db });
		assert.equal(degraded.termsAccepted, undefined);
		assert.equal(typeof degraded.canUpload, 'boolean');
	});
});
