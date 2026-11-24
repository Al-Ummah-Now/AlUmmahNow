import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	HARD_MAX_PAGES,
	LEGACY_RESTORE_POINTERS_PREFIX,
	backfillLegacyRestorePointers,
	parseCliArgs,
	parseLegacyRestoreKey,
	type BackfillStore,
} from '../legacy-restore-pointers.ts';

const USR_ACTIVE = 'usr_11111111111111111111111111111111';
const USR_SOFT = 'usr_22222222222222222222222222222222';
const USR_ERASED = 'usr_33333333333333333333333333333333';
const USR_RACE = 'usr_44444444444444444444444444444444';

function makeStore(initial: { backups?: Record<string, string>; profiles?: Record<string, Record<string, unknown>> }) {
	const backups = new Map<string, string>(Object.entries(initial.backups ?? {}));
	const profiles = new Map<string, Record<string, unknown>>(Object.entries(initial.profiles ?? {}));
	const headProfileCalls: string[] = [];
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
		async headProfile(profileId) {
			headProfileCalls.push(profileId);
			return profiles.has(profileId);
		},
		async headBackup(key) {
			return backups.has(key);
		},
		async putPointer(pointerKey) {
			putCalls.push(pointerKey);
			backups.set(pointerKey, '');
		},
		async deleteBackup(backupKey) {
			deleteCalls.push(backupKey);
			backups.delete(backupKey);
		},
	};
	return { store, backups, profiles, headProfileCalls, putCalls, deleteCalls };
}

describe('parseLegacyRestoreKey', () => {
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
});

describe('parseCliArgs', () => {
	it('defaults to dry-run, requires exactly one environment, and enforces hard page caps', () => {
		assert.deepEqual(parseCliArgs(['--env', 'qa']), {
			env: 'qa',
			apply: false,
			cursor: undefined,
			maxPages: 10,
			perPage: 1000,
		});
		assert.deepEqual(parseCliArgs(['--env', 'stage', '--apply', '--cursor', 'abc', '--max-pages', '5', '--per-page', '200']), {
			env: 'stage',
			apply: true,
			cursor: 'abc',
			maxPages: 5,
			perPage: 200,
		});

		assert.throws(() => parseCliArgs([]), /Missing required --env/);
		assert.throws(() => parseCliArgs(['--env', 'dev']), /Unknown --env/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--env', 'stage']), /only one --env/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--max-pages', '0']), /--max-pages/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--max-pages', String(HARD_MAX_PAGES + 1)]), /--max-pages/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--per-page', '1001']), /--per-page/);
		assert.throws(() => parseCliArgs(['--env', 'qa', '--unknown']), /Unknown argument/);
	});
});

describe('backfillLegacyRestorePointers', () => {
	it('dry run writes and deletes nothing while reporting accurate counts (soft-deleted profiles get pointers, never deleted)', async () => {
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
		assert.deepEqual(report.malformedKeys, [malformedKey]);
		assert.equal(report.distinctUsers, 3);
		assert.deepEqual(putCalls, []);
		assert.deepEqual(deleteCalls, []);
		assert.equal(backups.size, 6);
	});

	it('apply creates pointers for active and soft-deleted profiles, re-checks before deleting absent ones, leaves malformed keys alone, and is idempotent', async () => {
		const activeKey = `legacy-restore/job-1/${USR_ACTIVE}/v1.json`;
		const softKey = `legacy-restore/job-1/${USR_SOFT}/v1.json`;
		const erasedKey = `legacy-restore/job-1/${USR_ERASED}/v1.json`;
		const malformedKey = 'legacy-restore/not-valid';

		const { store, backups, headProfileCalls } = makeStore({
			backups: {
				[activeKey]: '{"id":"active"}',
				[softKey]: '{"id":"soft"}',
				[erasedKey]: '{"id":"erased"}',
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
		assert.equal(backups.has(malformedKey), true, 'malformed key left untouched');
		// Confirm profile absence was checked twice (initial + right before delete)
		assert.equal(headProfileCalls.filter((id) => id === USR_ERASED).length, 2);

		// Second pass is a complete no-op (idempotent)
		const second = await backfillLegacyRestorePointers(store, { dryRun: false });
		assert.equal(second.pointersCreated, 0);
		assert.equal(second.orphanedDeleted, 0);
		assert.equal(second.alreadyIndexed, 2);
	});

	it('pre-delete re-check aborts delete and indexes pointer if profile appears before delete', async () => {
		const raceKey = `legacy-restore/job-1/${USR_RACE}/v1.json`;
		const { store, backups, profiles, deleteCalls } = makeStore({
			backups: { [raceKey]: '{"id":"race"}' },
			profiles: {},
		});

		let checks = 0;
		const origHead = store.headProfile.bind(store);
		store.headProfile = async (id) => {
			if (id === USR_RACE) {
				checks++;
				if (checks === 1) {
					// Profile appears between initial classification and pre-delete re-check
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
		const { store, backups, deleteCalls } = makeStore({ backups: { [key]: '{}' } });
		store.headProfile = async () => {
			throw new Error('HEAD profiles: HTTP 500');
		};
		await assert.rejects(backfillLegacyRestorePointers(store, { dryRun: false }), /HTTP 500/);
		assert.deepEqual(deleteCalls, []);
		assert.equal(backups.has(key), true);
	});
});
