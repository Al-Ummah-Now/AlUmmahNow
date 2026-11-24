import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ENVIRONMENTS,
	HARD_MAX_PAGES,
	LEGACY_RESTORE_POINTERS_PREFIX,
	backfillLegacyRestorePointers,
	cfFetch,
	createR2BackfillStore,
	encodeR2KeyPath,
	formatCliReport,
	parseCliArgs,
	parseLegacyRestoreKey,
	type BackfillStore,
} from '../legacy-restore-pointers.ts';

const USR_ACTIVE = 'usr_11111111111111111111111111111111';
const USR_SOFT = 'usr_22222222222222222222222222222222';
const USR_ERASED = 'usr_33333333333333333333333333333333';
const USR_RACE = 'usr_44444444444444444444444444444444';
const USR_SENTINEL = 'usr_99999999999999999999999999999999';

function makeStore(initial: { backups?: Record<string, string>; profiles?: Record<string, Record<string, unknown>> }) {
	const backups = new Map<string, string>(Object.entries(initial.backups ?? {}));
	const profiles = new Map<string, Record<string, unknown>>(Object.entries(initial.profiles ?? {}));
	const headProfileCalls: string[] = [];
	const headBackupCalls: string[] = [];
	const putCalls: string[] = [];
	const deleteCalls: string[] = [];

	const store: BackfillStore = {
		async listBackups({ prefix, perPage, cursor }) {
			const keys = [...backups.keys()]
				.filter((k) => k.startsWith(prefix))
				.sort()
				.filter((k) => !cursor || k > cursor);
			const page = keys.slice(0, perPage);
			const truncated = perPage < keys.length;
			return { keys: page, truncated, cursor: truncated ? page[page.length - 1] : undefined };
		},
		async listProfilesSample() {
			const keys = [...profiles.keys()].sort();
			return keys.slice(0, 1);
		},
		async headProfile(profileId) {
			headProfileCalls.push(profileId);
			return profiles.has(profileId);
		},
		async headBackup(key) {
			headBackupCalls.push(key);
			return backups.has(key);
		},
		async putPointer(pointerKey) {
			putCalls.push(pointerKey);
			backups.set(pointerKey, '');
		},
		async deleteObject(key) {
			deleteCalls.push(key);
			backups.delete(key);
		},
	};
	return { store, backups, profiles, headProfileCalls, headBackupCalls, putCalls, deleteCalls };
}

describe('parseLegacyRestoreKey and encodeR2KeyPath', () => {
	it('parses valid backup keys, identifies existing pointers, and rejects malformed keys', () => {
		const valid = parseLegacyRestoreKey(`legacy-restore/job-123/${USR_ACTIVE}/etag_1.json`);
		assert.deepEqual(valid, {
			kind: 'backup',
			key: `legacy-restore/job-123/${USR_ACTIVE}/etag_1.json`,
			jobId: 'job-123',
			profileId: USR_ACTIVE,
			etag: 'etag_1',
			pointerKey: `${LEGACY_RESTORE_POINTERS_PREFIX}${USR_ACTIVE}/job-123/etag_1`,
		});

		assert.deepEqual(parseLegacyRestoreKey(`${LEGACY_RESTORE_POINTERS_PREFIX}${USR_ACTIVE}/job-123/etag_1`), {
			kind: 'pointer',
			key: `${LEGACY_RESTORE_POINTERS_PREFIX}${USR_ACTIVE}/job-123/etag_1`,
		});

		for (const bad of [
			`legacy-restore/by-user/${USR_ACTIVE}/etag_1.json`,
			`legacy-restore/by-user/${USR_ACTIVE}/by-user/etag_1`,
			`legacy-restore/job-1/not-a-usr-id/etag_1.json`,
			`legacy-restore/job-1/${USR_ACTIVE}/etag_1.txt`,
			`legacy-restore/job-1/${USR_ACTIVE}/extra/etag_1.json`,
			`legacy-restore/job-1/${USR_ACTIVE}/.json`,
			`legacy-restore/job-1/${USR_ACTIVE}/bad..etag.json`,
			'legacy-restore/readme.txt',
			`other-prefix/job-1/${USR_ACTIVE}/etag_1.json`,
		]) {
			assert.equal(parseLegacyRestoreKey(bad).kind, 'malformed', `expected malformed: ${bad}`);
		}
	});

	it('encodes R2 object keys segment-by-segment without turning slashes into %2F', () => {
		const key = `legacy-restore/job-123/${USR_ACTIVE}/v1.json`;
		const encoded = encodeR2KeyPath(key);
		assert.equal(encoded, `legacy-restore/job-123/${USR_ACTIVE}/v1.json`);
		assert.equal(encoded.includes('%2F'), false);
		assert.equal(encodeR2KeyPath('a/b c/d.json'), 'a/b%20c/d.json');
	});
});

describe('ENVIRONMENTS and parseCliArgs', () => {
	it('maps each environment to its exact R2 bucket pair', () => {
		assert.deepEqual(ENVIRONMENTS, {
			qa: { backupsBucket: 'admin-backups-qa', profilesBucket: 'profiles-qa' },
			stage: { backupsBucket: 'admin-backups-stage', profilesBucket: 'profiles-stage' },
			production: { backupsBucket: 'admin-backups', profilesBucket: 'profiles' },
		});
	});

	it('defaults to dry-run, requires one env, requires --confirm-1902-deployed with --apply, and enforces hard page caps', () => {
		assert.deepEqual(parseCliArgs(['--env', 'qa']), {
			env: 'qa',
			apply: false,
			confirm1902Deployed: false,
			cursor: undefined,
			cursorFile: undefined,
			maxPages: 10,
			perPage: 1000,
		});
		assert.deepEqual(parseCliArgs(['--env', 'stage', '--apply', '--confirm-1902-deployed', '--cursor', 'abc', '--max-pages', '5', '--per-page', '200']), {
			env: 'stage',
			apply: true,
			confirm1902Deployed: true,
			cursor: 'abc',
			cursorFile: undefined,
			maxPages: 5,
			perPage: 200,
		});
		assert.deepEqual(parseCliArgs(['--env', 'qa', '--cursor-file', '/tmp/c.cursor']), {
			env: 'qa',
			apply: false,
			confirm1902Deployed: false,
			cursor: undefined,
			cursorFile: '/tmp/c.cursor',
			maxPages: 10,
			perPage: 1000,
		});

		assert.throws(() => parseCliArgs([]), /Missing required --env/);
		assert.throws(() => parseCliArgs(['--env', 'dev']), /Unknown --env/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--env', 'stage']), /only one --env/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--cursor', 'a', '--cursor-file', '/tmp/a']), /not both/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--apply']), /--confirm-1902-deployed/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--max-pages', '0']), /--max-pages/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--max-pages', String(HARD_MAX_PAGES + 1)]), /--max-pages/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--per-page', '1001']), /--per-page/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--unknown']), /Unknown argument/);
	});

	it('formatCliReport omits raw nextCursor so stdout never prints a user ID encoded in an R2 cursor', () => {
		const out = formatCliReport(
			{ env: 'qa', backupsBucket: 'admin-backups-qa', profilesBucket: 'profiles-qa', cursorFile: '/tmp/legacy-restore-backfill-qa.cursor' },
			{
				dryRun: true,
				pagesProcessed: 1,
				scanned: 2,
				existingPointers: 0,
				alreadyIndexed: 0,
				pointersToCreate: 2,
				pointersCreated: 0,
				orphanedToDelete: 0,
				orphanedDeleted: 0,
				raceRecheckedAlive: 0,
				skippedMalformed: 0,
				distinctUsers: 2,
				complete: false,
				nextCursor: `legacy-restore/job-1/${USR_ACTIVE}/v1.json`,
			},
		);
		assert.equal('nextCursor' in out, false);
		assert.equal(out.hasMore, true);
		assert.equal(out.cursorFile, '/tmp/legacy-restore-backfill-qa.cursor');
		assert.equal(JSON.stringify(out).includes(USR_ACTIVE), false);
	});
});

describe('HTTP layer (cfFetch and createR2BackfillStore)', () => {
	const noSleep = async () => undefined;

	it('handles 200/404/403/500/429 in headProfile, headBackup, list, putPointer, and deleteObject without printing user IDs in errors', async () => {
		const seen: Array<{ method: string; url: string }> = [];
		const responses: Array<() => Response> = [];
		const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			seen.push({ method: init?.method ?? 'GET', url: String(input) });
			const next = responses.shift();
			if (!next) throw new Error('unexpected fetch call');
			return next();
		}) as typeof fetch;

		const store = createR2BackfillStore({
			env: 'qa',
			token: 'tok',
			accountId: 'acct1',
			deps: { fetch: fakeFetch, sleep: noSleep, maxAttempts: 2 },
		});

		// HEAD 200 -> true, HEAD 404 -> false
		responses.push(() => new Response(null, { status: 200 }));
		assert.equal(await store.headProfile(USR_ACTIVE), true);
		assert.equal(seen[0].url, `https://api.cloudflare.com/client/v4/accounts/acct1/r2/buckets/profiles-qa/objects/${USR_ACTIVE}`);

		responses.push(() => new Response(null, { status: 404 }));
		assert.equal(await store.headProfile(USR_ERASED), false);

		// Slash-containing backup key uses segment encoding (no %2F)
		const bKey = `legacy-restore/job-1/${USR_ACTIVE}/v1.json`;
		responses.push(() => new Response(null, { status: 200 }));
		assert.equal(await store.headBackup(bKey), true);
		assert.equal(seen[2].url, `https://api.cloudflare.com/client/v4/accounts/acct1/r2/buckets/admin-backups-qa/objects/${bKey}`);
		assert.equal(seen[2].url.includes('%2F'), false);

		// 403 throws immediately without retrying and without leaking userId
		responses.push(() => new Response(null, { status: 403 }));
		await assert.rejects(store.headProfile(USR_ACTIVE), (err: Error) => {
			assert.match(err.message, /HEAD profiles-qa: HTTP 403/);
			assert.equal(err.message.includes(USR_ACTIVE), false, 'error omits user ID');
			return true;
		});

		// 500 retries up to maxAttempts then throws
		responses.push(() => new Response(null, { status: 500 }), () => new Response(null, { status: 500 }), () => new Response(null, { status: 500 }));
		await assert.rejects(store.headProfile(USR_ACTIVE), /HEAD profiles-qa: HTTP 500/);

		// 429 retries up to maxAttempts then throws
		responses.push(
			() => new Response(null, { status: 429, headers: { 'retry-after': '1' } }),
			() => new Response(null, { status: 429 }),
			() => new Response(null, { status: 429 }),
		);
		await assert.rejects(store.headProfile(USR_ACTIVE), /HEAD profiles-qa: HTTP 429/);

		// Bucket-missing 404 on LIST aborts with Cloudflare error code
		responses.push(() => new Response(JSON.stringify({ success: false, errors: [{ code: 10006, message: 'The specified bucket does not exist.' }] }), { status: 404 }));
		await assert.rejects(store.listProfilesSample(), /LIST profiles-qa: HTTP 404 \(code 10006\)/);

		// putPointer sends PUT with empty body; deleteObject tolerates 404 and throws on 403
		responses.push(() => new Response(null, { status: 200 }));
		await store.putPointer(`${LEGACY_RESTORE_POINTERS_PREFIX}${USR_ACTIVE}/job-1/v1`);
		responses.push(() => new Response(null, { status: 404 }));
		await store.deleteObject(`${LEGACY_RESTORE_POINTERS_PREFIX}${USR_ERASED}/job-1/v1`);
		responses.push(() => new Response(null, { status: 403 }));
		await assert.rejects(store.deleteObject(bKey), (err: Error) => {
			assert.match(err.message, /DELETE admin-backups-qa: HTTP 403/);
			assert.equal(err.message.includes(USR_ACTIVE), false);
			return true;
		});
	});

	it('cfFetch retries transient 429 and succeeds when a later attempt returns 200', async () => {
		let calls = 0;
		const sleeps: number[] = [];
		const res = await cfFetch(
			'https://api.cloudflare.com/test',
			{ method: 'HEAD' },
			'tok',
			{
				fetch: (async () => (++calls === 1 ? new Response(null, { status: 429, headers: { 'retry-after': '2' } }) : new Response(null, { status: 200 }))) as typeof fetch,
				sleep: async (ms) => void sleeps.push(ms),
			},
		);
		assert.equal(res.status, 200);
		assert.equal(calls, 2);
		assert.deepEqual(sleeps, [2000]);
	});
});

describe('backfillLegacyRestorePointers', () => {
	it('dry run writes and deletes nothing while reporting counts only (no user IDs) and preserving soft-deleted profiles', async () => {
		const activeKey = `legacy-restore/job-1/${USR_ACTIVE}/v1.json`;
		const softKey = `legacy-restore/job-1/${USR_SOFT}/v1.json`;
		const erasedKey = `legacy-restore/job-1/${USR_ERASED}/v1.json`;
		const alreadyKey = `legacy-restore/job-2/${USR_ACTIVE}/v2.json`;
		const alreadyPtr = `${LEGACY_RESTORE_POINTERS_PREFIX}${USR_ACTIVE}/job-2/v2`;
		const malformedKey = 'legacy-restore/unexpected/file.json';

		const { store, backups, putCalls, deleteCalls } = makeStore({
			backups: {
				[activeKey]: '{"id":"active"}',
				[softKey]: '{"id":"soft"}',
				[erasedKey]: '{"id":"erased"}',
				[alreadyKey]: '{"id":"active2"}',
				[alreadyPtr]: '',
				[malformedKey]: '{}',
			},
			profiles: {
				[USR_ACTIVE]: { id: USR_ACTIVE },
				[USR_SOFT]: { id: USR_SOFT, adminDeletion: { at: '2026-11-20T00:00:00.000Z', by: 'usr_admin' } },
			},
		});

		const report = await backfillLegacyRestorePointers(store, { dryRun: true });
		assert.equal(report.dryRun, true);
		assert.equal(report.complete, true);
		assert.equal(report.nextCursor, null);
		assert.equal(report.scanned, 6);
		assert.equal(report.existingPointers, 1);
		assert.equal(report.alreadyIndexed, 1);
		assert.equal(report.pointersToCreate, 2, 'active and soft-deleted profiles both get pointers');
		assert.equal(report.pointersCreated, 0);
		assert.equal(report.orphanedToDelete, 1);
		assert.equal(report.orphanedDeleted, 0);
		assert.equal(report.skippedMalformed, 1);
		assert.equal(report.distinctUsers, 3);
		assert.equal(JSON.stringify(report).includes('usr_'), false, 'report contains counts only, no user IDs');
		assert.deepEqual(putCalls, []);
		assert.deepEqual(deleteCalls, []);
		assert.equal(backups.size, 6);
	});

	it('apply creates pointers for active and soft-deleted profiles, re-checks before deleting absent ones (plus pointer), leaves malformed keys alone, and is idempotent', async () => {
		const activeKey = `legacy-restore/job-1/${USR_ACTIVE}/v1.json`;
		const softKey = `legacy-restore/job-1/${USR_SOFT}/v1.json`;
		const erasedKey = `legacy-restore/job-1/${USR_ERASED}/v1.json`;
		const erasedPtr = `${LEGACY_RESTORE_POINTERS_PREFIX}${USR_ERASED}/job-1/v1`;
		const malformedKey = 'legacy-restore/not-valid';

		const { store, backups, headProfileCalls, deleteCalls } = makeStore({
			backups: {
				[activeKey]: '{"id":"active"}',
				[softKey]: '{"id":"soft"}',
				[erasedKey]: '{"id":"erased"}',
				[erasedPtr]: '',
				[malformedKey]: '{}',
			},
			profiles: {
				[USR_ACTIVE]: { id: USR_ACTIVE },
				[USR_SOFT]: { id: USR_SOFT, adminDeletion: { at: '2026-11-20T00:00:00.000Z', by: 'usr_admin' } },
			},
		});

		const applied = await backfillLegacyRestorePointers(store, { dryRun: false });
		assert.equal(applied.complete, true);
		assert.equal(applied.pointersCreated, 2);
		assert.equal(applied.orphanedDeleted, 1);
		assert.equal(applied.skippedMalformed, 1);
		assert.equal(backups.has(activeKey), true);
		assert.equal(backups.has(`${LEGACY_RESTORE_POINTERS_PREFIX}${USR_ACTIVE}/job-1/v1`), true);
		assert.equal(backups.has(softKey), true, 'soft-deleted profile backup is never deleted');
		assert.equal(backups.has(`${LEGACY_RESTORE_POINTERS_PREFIX}${USR_SOFT}/job-1/v1`), true);
		assert.equal(backups.has(erasedKey), false, 'absent profile backup deleted');
		assert.equal(backups.has(erasedPtr), false, 'leftover pointer deleted alongside orphaned backup');
		assert.deepEqual(deleteCalls, [erasedKey, erasedPtr], 'backup deleted before pointer');
		assert.equal(backups.has(malformedKey), true, 'malformed key left untouched');
		assert.equal(headProfileCalls.filter((id) => id === USR_ERASED).length, 2);

		// Second pass is a complete no-op (idempotent)
		const second = await backfillLegacyRestorePointers(store, { dryRun: false });
		assert.equal(second.pointersCreated, 0);
		assert.equal(second.orphanedDeleted, 0);
		assert.equal(second.alreadyIndexed, 2);
	});

	it('positive control aborts without deleting when profiles bucket is empty, sample profile HEAD fails, or backup HEAD returns 404', async () => {
		const key = `legacy-restore/job-1/${USR_ERASED}/v1.json`;

		// 1. Empty profiles bucket -> aborts
		const empty = makeStore({ backups: { [key]: '{}' }, profiles: {} });
		await assert.rejects(backfillLegacyRestorePointers(empty.store, { dryRun: false }), /profiles bucket is empty/);
		assert.deepEqual(empty.deleteCalls, []);
		assert.equal(empty.backups.has(key), true);

		// 2. Profiles bucket has a sample key, but HEAD returns 404 -> aborts
		const badProfileHead = makeStore({ backups: { [key]: '{}' }, profiles: { [USR_SENTINEL]: { id: USR_SENTINEL } } });
		badProfileHead.store.headProfile = async () => false;
		await assert.rejects(backfillLegacyRestorePointers(badProfileHead.store, { dryRun: false }), /HEAD on an existing profile returned 404/);
		assert.deepEqual(badProfileHead.deleteCalls, []);
		assert.equal(badProfileHead.backups.has(key), true);

		// 3. Profiles bucket passes, but HEAD on the backup itself returns 404 (e.g. %2F / wrong bucket) -> aborts
		const badBackupHead = makeStore({ backups: { [key]: '{}' }, profiles: { [USR_SENTINEL]: { id: USR_SENTINEL } } });
		badBackupHead.store.headBackup = async () => false;
		await assert.rejects(backfillLegacyRestorePointers(badBackupHead.store, { dryRun: false }), /HEAD on listed backup object returned 404/);
		assert.deepEqual(badBackupHead.deleteCalls, []);
		assert.equal(badBackupHead.backups.has(key), true);
	});

	it('pre-delete re-check aborts delete and indexes pointer if profile appears before delete', async () => {
		const raceKey = `legacy-restore/job-1/${USR_RACE}/v1.json`;
		const { store, backups, profiles, deleteCalls } = makeStore({
			backups: { [raceKey]: '{"id":"race"}' },
			profiles: { [USR_SENTINEL]: { id: USR_SENTINEL } },
		});

		let checks = 0;
		const origHead = store.headProfile.bind(store);
		store.headProfile = async (id) => {
			if (id === USR_RACE) {
				checks++;
				if (checks === 1) {
					profiles.set(USR_RACE, { id: USR_RACE });
					return false;
				}
			}
			return origHead(id);
		};

		const report = await backfillLegacyRestorePointers(store, { dryRun: false });
		assert.equal(report.raceRecheckedAlive, 1);
		assert.equal(report.orphanedDeleted, 0);
		assert.equal(report.pointersCreated, 1);
		assert.deepEqual(deleteCalls, []);
		assert.equal(backups.has(raceKey), true, 'backup preserved when pre-delete re-check sees profile');
		assert.equal(backups.has(`${LEGACY_RESTORE_POINTERS_PREFIX}${USR_RACE}/job-1/v1`), true);
	});

	it('respects maxPages cap and resumes cleanly via cursor until complete', async () => {
		const initial: Record<string, string> = {};
		const profiles: Record<string, Record<string, unknown>> = {};
		for (let i = 0; i < 5; i++) {
			const id = `usr_${String(i).padStart(32, '0')}`;
			initial[`legacy-restore/job-${i}/${id}/v1.json`] = '{}';
			profiles[id] = { id };
		}
		const { store, backups } = makeStore({ backups: initial, profiles });

		const first = await backfillLegacyRestorePointers(store, { dryRun: false, maxPages: 2, perPage: 2 });
		assert.equal(first.complete, false);
		assert.equal(first.pagesProcessed, 2);
		assert.equal(first.pointersCreated, 4);
		assert.ok(first.nextCursor);

		const rest = await backfillLegacyRestorePointers(store, { dryRun: false, maxPages: 2, perPage: 2, cursor: first.nextCursor! });
		assert.equal(rest.complete, true);
		assert.equal(rest.nextCursor, null);
		assert.equal(rest.pointersCreated, 1);
		assert.equal(backups.size, 10);
	});

	it('aborts without deleting when headProfile fails with an error', async () => {
		const key = `legacy-restore/job-1/${USR_ERASED}/v1.json`;
		const { store, backups, deleteCalls } = makeStore({
			backups: { [key]: '{}' },
			profiles: { [USR_SENTINEL]: { id: USR_SENTINEL } },
		});
		const origHead = store.headProfile.bind(store);
		store.headProfile = async (id) => {
			if (id === USR_ERASED) throw new Error('HEAD profiles: HTTP 500');
			return origHead(id);
		};
		await assert.rejects(backfillLegacyRestorePointers(store, { dryRun: false }), /HTTP 500/);
		assert.deepEqual(deleteCalls, []);
		assert.equal(backups.has(key), true);
	});
});
