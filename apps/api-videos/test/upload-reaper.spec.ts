/**
 * Upload reaper (owner, 2026-11-10): abandoned placeholders and Bunny orphans
 * are removed by a queued loop with a confirming second check, starting in
 * dry-run, never touching ready videos.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ABANDON_AFTER_MS,
	FLAGGED_GRACE_MS,
	isAbandonedCandidate,
	markUploadCreated,
	belongsToEnv,
	CONFIRM_DELAY_SECONDS,
	decideReap,
	FORCE_CONFIRM_DELAY_SECONDS,
	handleReaperBatch,
	itemKey,
	keepItem,
	REAPER_AUDIT_PREFIX,
	REAPER_KIND,
	REAPER_MAX_DELIVERIES,
	reaperRetryDelaySeconds,
	runReaperCheck,
	startReaperLoop,
	sweepStaleUploads,
	writeReaperConfig,
	type ReapInput,
	type ReaperMessage,
} from '../src/lib/uploads/reaper';
import { claimObjectKey } from '../src/lib/uploads/initiateOnce';
import { MemoryBucket, videoFixture } from './helpers';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const H = 3600 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ID = '11111111-2222-4333-8444-555555555555';
const ORPHAN = '99999999-2222-4333-8444-555555555555';
const realFetch = globalThis.fetch;

class DelayQueue {
	sent: { body: any; delaySeconds?: number }[] = [];
	async send(body: unknown, opts?: { delaySeconds?: number }) {
		this.sent.push({ body, delaySeconds: opts?.delaySeconds });
	}
}

const LEGACY_LIBRARY = '999999';

/** Bunny stub: videos by guid, TUS offsets, a library listing; records every DELETE. */
function bunnyStub() {
	const s = {
		videos: new Map<string, { guid: string; title: string; status: number; dateUploaded: string }>(),
		/** A second (legacy) library, id LEGACY_LIBRARY */
		legacy: new Map<string, { guid: string; title: string; status: number; dateUploaded: string; storageSize?: number; length?: number }>(),
		offset: new Map<string, number>(),
		deleted: [] as string[],
		failGet: 0,
	};
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.startsWith('https://video.bunnycdn.com/tusupload/')) {
			const id = url.split('/').pop()!;
			const o = s.offset.get(id);
			return o === undefined ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { 'Upload-Offset': String(o) } });
		}
		const list = url.match(/\/library\/(\d+)\/videos\?page=(\d+)/);
		if (list) {
			const all = [...(list[1] === LEGACY_LIBRARY ? s.legacy : s.videos).values()];
			const page = Number(list[2]);
			return new Response(JSON.stringify({ totalItems: all.length, items: all.slice((page - 1) * 100, page * 100) }), { status: 200 });
		}
		const one = url.match(/\/library\/\d+\/videos\/([0-9a-f-]{36})$/);
		if (one && method === 'GET') {
			if (s.failGet > 0) {
				s.failGet--;
				return new Response('busy', { status: 503 });
			}
			const v = (url.includes(`/library/${LEGACY_LIBRARY}/`) ? s.legacy : s.videos).get(one[1]);
			return v ? new Response(JSON.stringify(v), { status: 200 }) : new Response(null, { status: 404 });
		}
		if (one && method === 'DELETE') {
			s.deleted.push(one[1]);
			const had = (url.includes(`/library/${LEGACY_LIBRARY}/`) ? s.legacy : s.videos).delete(one[1]);
			return new Response(null, { status: had ? 200 : 404 });
		}
		throw new Error(`unexpected fetch ${method} ${url}`);
	}) as typeof fetch;
	return s;
}

function makeEnv(prefix = '') {
	return {
		videos: new MemoryBucket(),
		channels: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new DelayQueue(),
		PROCESSING_CHECK_QUEUE: new DelayQueue(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '400189',
		bunny_hostname: 'vz-test.b-cdn.net',
		BUNNY_NAME_PREFIX: prefix,
	} as any;
}

function placeholder(overrides: Record<string, unknown> = {}) {
	return videoFixture({
		id: ID,
		userId: 'alice',
		channelId: 'ch1',
		uploadStatus: 'uploading',
		fileSize: 1000,
		dateCreated: ago(30 * H),
		dateModified: ago(30 * H),
		uploadFingerprint: 'fp1',
		tusUpload: { sessionId: 'up1', bunnyUploadUrl: `https://video.bunnycdn.com/tusupload/${ID}`, fileSize: 1000, createdAt: ago(30 * H) },
		...overrides,
	});
}

function input(over: Partial<ReapInput> = {}): ReapInput {
	return {
		target: 'abandoned',
		now: NOW.getTime(),
		mode: 'live',
		force: false,
		check: 1,
		record: placeholder() as any,
		bunny: { guid: ID, status: 0, title: 'Lecture', dateUploaded: ago(30 * H) },
		prefix: '',
		offsetNow: 200,
		offsetBefore: 200,
		...over,
	};
}

describe('decideReap: abandoned placeholders', () => {
	it('quiet for 24 h with no progress: confirm first, delete on the second check', () => {
		assert.deepEqual(decideReap(input({ check: 0 })), { action: 'confirm', delaySeconds: CONFIRM_DELAY_SECONDS, reason: 'No upload progress for 24 hours; Bunny status 0' });
		assert.equal(decideReap(input()).action, 'delete');
	});

	it('the 24-hour threshold counts the latest activity (created, modified, resumed, initiated, upload created)', () => {
		const just = ABANDON_AFTER_MS - 60_000;
		for (const field of ['dateCreated', 'dateModified', 'lastResumeAt', 'lastInitiateAt']) {
			assert.equal(decideReap(input({ record: placeholder({ [field]: ago(just) }) as any })).action, 'keep', field);
		}
		const tus = placeholder({ tusUpload: { sessionId: 's', bunnyUploadUrl: 'u', fileSize: 1000, createdAt: ago(just) } });
		assert.equal(decideReap(input({ record: tus as any })).action, 'keep');
		assert.equal(decideReap(input({ record: placeholder({ dateCreated: ago(ABANDON_AFTER_MS), dateModified: ago(ABANDON_AFTER_MS) }) as any })).action, 'delete');
	});

	it('keeps finished uploads and anything whose bytes arrived at Bunny (never touches ready videos)', () => {
		for (const status of ['ready', 'processing']) assert.equal(decideReap(input({ record: placeholder({ uploadStatus: status }) as any })).action, 'keep');
		for (const status of [1, 2, 3, 4, 5, 7, 8]) assert.equal(decideReap(input({ bunny: { status } })).action, 'keep', `bunny ${status}`);
	});

	it('keeps an upload that progressed between the checks, or holds every byte', () => {
		assert.equal(decideReap(input({ offsetBefore: 100, offsetNow: 200 })).action, 'keep');
		assert.equal(decideReap(input({ offsetNow: 1000, offsetBefore: 1000 })).action, 'keep');
	});

	it('UploadFailed (6) is deletable; a placeholder Bunny no longer has is only marked', () => {
		assert.deepEqual(decideReap(input({ bunny: { status: 6 } })), { action: 'delete', reason: 'No upload progress for 24 hours; Bunny status 6', deleteBunny: true });
		assert.deepEqual(decideReap(input({ bunny: null, offsetNow: null, offsetBefore: null })), { action: 'delete', reason: 'No upload progress for 24 hours; not at Bunny', deleteBunny: false });
	});

	it('dry-run records "would delete" after the confirming check and changes nothing', () => {
		assert.equal(decideReap(input({ mode: 'dry-run', check: 0 })).action, 'confirm');
		assert.equal(decideReap(input({ mode: 'dry-run' })).action, 'would_delete');
	});

	it('an admin "Delete now" skips the 24-hour wait and dry-run, with a short confirming check', () => {
		const fresh = placeholder({ dateCreated: ago(H), dateModified: ago(H) }) as any;
		assert.deepEqual(decideReap(input({ record: fresh, force: true, check: 0, mode: 'dry-run' })), { action: 'confirm', delaySeconds: FORCE_CONFIRM_DELAY_SECONDS, reason: 'No upload progress for 24 hours; Bunny status 0' });
		assert.equal(decideReap(input({ record: fresh, force: true, mode: 'dry-run' })).action, 'delete');
		assert.equal(decideReap(input({ force: true, record: placeholder({ uploadStatus: 'ready' }) as any })).action, 'keep', 'force never deletes a finished video');
	});

	it('an upload flagged for re-upload keeps its Re-upload for 7 days after the flag; Delete now still can', () => {
		const flagged = (at: string) => placeholder({ uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', reason: 'stalled', at } }) as any;
		assert.deepEqual(decideReap(input({ record: flagged(ago(FLAGGED_GRACE_MS - H)) })), { action: 'keep', reason: 'Flagged for re-upload; the uploader has 7 days to re-upload' });
		assert.equal(isAbandonedCandidate(flagged(ago(FLAGGED_GRACE_MS - H)), NOW.getTime()), false);
		assert.equal(decideReap(input({ record: flagged(ago(FLAGGED_GRACE_MS - H)), force: true })).action, 'delete');
		assert.equal(decideReap(input({ record: flagged(ago(FLAGGED_GRACE_MS + H)) })).action, 'delete');
		assert.equal(isAbandonedCandidate(flagged(ago(FLAGGED_GRACE_MS + H)), NOW.getTime()), true);
		const otherIssue = placeholder({ uploadStatus: 'failed', processingIssue: { kind: 'stalled', at: ago(H) } }) as any;
		assert.equal(decideReap(input({ record: otherIssue })).action, 'delete');
	});

	it('allowlist: only an unfinished upload (initiated, uploading, failed) an upload flow wrote is abandoned, even for Delete now', () => {
		for (const status of ['initiated', 'uploading', 'failed']) assert.equal(decideReap(input({ record: placeholder({ uploadStatus: status }) as any })).action, 'delete', status);
		for (const status of [undefined, 'scheduled', 'live', 'archived']) {
			assert.equal(decideReap(input({ record: placeholder({ uploadStatus: status }) as any })).action, 'keep', String(status));
			assert.equal(decideReap(input({ force: true, record: placeholder({ uploadStatus: status }) as any })).action, 'keep', `forced ${status}`);
		}
		const notUpload = placeholder({ uploadFingerprint: undefined, tusUpload: undefined, lastInitiateAt: undefined, originalFormat: undefined }) as any;
		assert.deepEqual(decideReap(input({ record: notUpload, force: true })), { action: 'keep', reason: 'Not an upload record' });
		assert.equal(isAbandonedCandidate(notUpload, NOW.getTime()), false);
		assert.equal(isAbandonedCandidate(placeholder({ uploadStatus: 'scheduled' }) as any, NOW.getTime()), false);
		assert.equal(decideReap(input({ record: placeholder({ uploadFingerprint: undefined, tusUpload: undefined, originalFormat: 'video/mp4' }) as any })).action, 'delete', 'a legacy initiate record');
	});

	it('idempotent: an abandoned record is done; one whose Bunny delete was interrupted is finished', () => {
		const abandoned = placeholder({ abandoned: { at: 'x', reason: 'r', by: 'reaper', bunnyDeleted: true }, isDeleted: true }) as any;
		assert.equal(decideReap(input({ record: abandoned, bunny: null })).action, 'keep');
		assert.equal(decideReap(input({ record: abandoned })).action, 'delete');
		assert.equal(decideReap(input({ record: placeholder({ isDeleted: true }) as any })).action, 'keep', 'deleted by another flow');
	});
});

describe('decideReap: orphans', () => {
	const orphan = (over: Partial<ReapInput> = {}) => input({ target: 'orphan', record: null, offsetNow: null, offsetBefore: null, uploadMarker: true, ...over });

	it('no record, ours, older than 24 h, not ready: confirm, then delete', () => {
		assert.equal(decideReap(orphan({ check: 0 })).action, 'confirm');
		assert.equal(decideReap(orphan()).action, 'delete');
		assert.equal(decideReap(orphan({ bunny: { status: 5, dateUploaded: ago(30 * H) } })).action, 'delete');
	});

	it('the second check finding a record keeps it', () => {
		assert.equal(decideReap(orphan({ record: placeholder() as any })).action, 'keep');
	});

	it('never ready or encoding videos, never young ones, never another environment', () => {
		for (const status of [1, 2, 3, 4, 7, 9]) assert.equal(decideReap(orphan({ bunny: { status, dateUploaded: ago(30 * H) } })).action, 'keep');
		assert.equal(decideReap(orphan({ bunny: { status: 0, dateUploaded: ago(23 * H) } })).action, 'keep');
		assert.equal(decideReap(orphan({ bunny: { status: 0, title: '[stage] Lecture', dateUploaded: ago(30 * H) } })).action, 'keep');
		assert.equal(decideReap(orphan({ prefix: '[stage] ', bunny: { status: 0, title: 'Lecture', dateUploaded: ago(30 * H) } })).action, 'keep');
		assert.equal(decideReap(orphan({ prefix: '[stage] ', bunny: { status: 0, title: '[stage] Lecture', dateUploaded: ago(30 * H) } })).action, 'delete');
	});

	it('only an upload-made Bunny video is an automatic orphan; a live stream video never is, even for Delete now', () => {
		assert.deepEqual(decideReap(orphan({ uploadMarker: false })), { action: 'keep', reason: 'Not created by an upload (no upload marker): only an admin Delete now removes it' });
		assert.equal(decideReap(orphan({ uploadMarker: false, force: true })).action, 'delete', 'an admin Delete now still can');
		assert.deepEqual(decideReap(orphan({ liveStreamRef: true })), { action: 'keep', reason: 'A live stream refers to it' });
		assert.equal(decideReap(orphan({ liveStreamRef: true, force: true })).action, 'keep');
	});

	it('an empty entry (never a byte) without a marker is an orphan after 7 days (#1163)', () => {
		const empty = (age: number, extra: Record<string, unknown> = {}) => ({ status: 0, storageSize: 0, length: 0, encodeProgress: 0, dateUploaded: ago(age), ...extra });
		assert.equal(decideReap(orphan({ uploadMarker: false, check: 0, bunny: empty(8 * 24 * H) })).action, 'confirm');
		assert.equal(decideReap(orphan({ uploadMarker: false, bunny: empty(8 * 24 * H) })).action, 'delete');
		assert.equal(decideReap(orphan({ uploadMarker: false, bunny: empty(6 * 24 * H) })).action, 'keep', 'younger than 7 days');
		assert.equal(decideReap(orphan({ uploadMarker: false, bunny: empty(8 * 24 * H, { storageSize: 1024 }) })).action, 'keep', 'it has bytes');
		assert.equal(decideReap(orphan({ uploadMarker: false, bunny: empty(8 * 24 * H, { length: 12 }) })).action, 'keep', 'it has a length');
		assert.equal(decideReap(orphan({ uploadMarker: false, liveStreamRef: true, bunny: empty(8 * 24 * H) })).action, 'keep', 'a live stream refers to it');
	});

	it('belongsToEnv: prefix rule', () => {
		assert.equal(belongsToEnv('Lecture', ''), true);
		assert.equal(belongsToEnv('[stage] Lecture', ''), false);
		assert.equal(belongsToEnv('[qa] x', ''), false);
		assert.equal(belongsToEnv('[stage] Lecture', '[stage] '), true);
		assert.equal(belongsToEnv('Lecture', '[stage] '), false);
	});
});

describe('reaper loop', () => {
	let bunny: ReturnType<typeof bunnyStub>;
	beforeEach(() => {
		bunny = bunnyStub();
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	async function runQueued(env: any, at = NOW) {
		const msgs = env.PROCESSING_CHECK_QUEUE.sent.splice(0);
		for (const m of msgs) await runReaperCheck(env, m.body as ReaperMessage, at);
		return msgs;
	}

	it('live: abandoned placeholder → confirm → Bunny delete, record soft-removed, audit row with backup, claim released', async () => {
		const env = makeEnv();
		await writeReaperConfig(env, 'live', 'admin@test');
		await env.videos.put(ID, JSON.stringify(placeholder()));
		await env.global_settings.put(claimObjectKey('fp1'), JSON.stringify({ key: 'fp1', state: 'bound', videoId: ID }));
		bunny.videos.set(ID, { guid: ID, title: 'Lecture', status: 0, dateUploaded: ago(30 * H) });
		bunny.offset.set(ID, 200);

		assert.equal((await startReaperLoop(env, ID, 'abandoned', { reason: 'test', now: NOW })).started, true);
		const first = await runQueued(env);
		assert.equal(first.length, 1);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[0].delaySeconds, CONFIRM_DELAY_SECONDS);
		assert.equal(bunny.deleted.length, 0, 'nothing deleted on the first check');

		await runQueued(env, new Date(NOW.getTime() + CONFIRM_DELAY_SECONDS * 1000));
		assert.deepEqual(bunny.deleted, [ID]);
		const record = env.videos.read(ID);
		assert.equal(record.isDeleted, true);
		assert.equal(record.abandoned.by, 'reaper');
		assert.equal(record.uploadStatus, 'failed');
		assert.equal(record.tusUpload, undefined);
		assert.equal(env.global_settings.read(claimObjectKey('fp1')), null, 'claim released');
		const item = env.global_settings.read(itemKey(ID));
		assert.equal(item.status, 'deleted');
		const audit = env.global_settings.read(item.auditKey);
		assert.ok(item.auditKey.startsWith(REAPER_AUDIT_PREFIX));
		assert.equal(audit.state, 'done');
		assert.equal(audit.backup.bunny.guid, ID);
		assert.equal(audit.backup.record.id, ID);
	});

	it('dry-run (the default): the same item is only marked "would delete"', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(placeholder()));
		bunny.videos.set(ID, { guid: ID, title: 'Lecture', status: 0, dateUploaded: ago(30 * H) });
		bunny.offset.set(ID, 200);
		await startReaperLoop(env, ID, 'abandoned', { reason: 'test', now: NOW });
		await runQueued(env);
		await runQueued(env, new Date(NOW.getTime() + CONFIRM_DELAY_SECONDS * 1000));
		assert.equal(bunny.deleted.length, 0);
		assert.equal(env.videos.read(ID).isDeleted, undefined);
		assert.equal(env.global_settings.read(itemKey(ID)).status, 'would_delete');
	});

	it('an upload that moves between the checks is kept', async () => {
		const env = makeEnv();
		await writeReaperConfig(env, 'live', 'a');
		await env.videos.put(ID, JSON.stringify(placeholder()));
		bunny.videos.set(ID, { guid: ID, title: 'Lecture', status: 0, dateUploaded: ago(30 * H) });
		bunny.offset.set(ID, 200);
		await startReaperLoop(env, ID, 'abandoned', { reason: 'test', now: NOW });
		await runQueued(env);
		bunny.offset.set(ID, 400);
		await runQueued(env, new Date(NOW.getTime() + CONFIRM_DELAY_SECONDS * 1000));
		assert.equal(bunny.deleted.length, 0);
		assert.equal(env.global_settings.read(itemKey(ID)).status, 'skipped');
	});

	it('orphan double check: a record that appears before the second check saves the video', async () => {
		const env = makeEnv();
		await writeReaperConfig(env, 'live', 'a');
		bunny.videos.set(ORPHAN, { guid: ORPHAN, title: 'Lecture', status: 0, dateUploaded: ago(30 * H) });
		await startReaperLoop(env, ORPHAN, 'orphan', { reason: 'test', now: NOW });
		await runQueued(env);
		await env.videos.put(ORPHAN, JSON.stringify(placeholder({ id: ORPHAN })));
		await runQueued(env, new Date(NOW.getTime() + CONFIRM_DELAY_SECONDS * 1000));
		assert.equal(bunny.deleted.length, 0);
	});

	it('orphan confirmed on the second check is deleted (no record write)', async () => {
		const env = makeEnv();
		await writeReaperConfig(env, 'live', 'a');
		bunny.videos.set(ORPHAN, { guid: ORPHAN, title: 'Lecture', status: 6, dateUploaded: ago(30 * H) });
		await markUploadCreated(env.global_settings as never, ORPHAN, { userId: 'alice', channelId: 'ch1' });
		await startReaperLoop(env, ORPHAN, 'orphan', { reason: 'test', now: NOW });
		await runQueued(env);
		await runQueued(env, new Date(NOW.getTime() + CONFIRM_DELAY_SECONDS * 1000));
		assert.deepEqual(bunny.deleted, [ORPHAN]);
		assert.equal(env.videos.read(ORPHAN), null);
	});

	it('an orphan without the upload marker, or one a live stream refers to, is kept', async () => {
		const env = makeEnv();
		await writeReaperConfig(env, 'live', 'a');
		bunny.videos.set(ORPHAN, { guid: ORPHAN, title: 'Lecture', status: 0, dateUploaded: ago(30 * H) });
		await startReaperLoop(env, ORPHAN, 'orphan', { reason: 'test', now: NOW });
		await runQueued(env);
		assert.deepEqual(bunny.deleted, []);
		await env.videos.put('livestream:ls1', JSON.stringify({ id: 'ls1', streamUrl: `https://iframe.mediadelivery.net/embed/1/${ORPHAN}` }));
		await startReaperLoop(env, ORPHAN, 'orphan', { reason: 'admin', force: true, now: NOW });
		await runQueued(env);
		await runQueued(env, new Date(NOW.getTime() + 120_000));
		assert.deepEqual(bunny.deleted, [], 'Delete now never removes a live stream video');
	});

	it('deduped: a second start while a loop is live does nothing; a superseded message is dropped', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(placeholder()));
		assert.equal((await startReaperLoop(env, ID, 'abandoned', { reason: 'a', now: NOW })).started, true);
		assert.deepEqual(await startReaperLoop(env, ID, 'abandoned', { reason: 'b', now: NOW }), { started: false, why: 'loop already active' });
		const stale = env.PROCESSING_CHECK_QUEUE.sent[0].body;
		await startReaperLoop(env, ID, 'abandoned', { reason: 'admin', force: true, now: NOW });
		assert.deepEqual(await runReaperCheck(env, stale, NOW), { action: 'drop', reason: 'superseded loop' });
	});

	it('kept by an admin: the sweep never picks it again', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(placeholder()));
		await startReaperLoop(env, ID, 'abandoned', { reason: 'a', now: NOW });
		await keepItem(env, ID, 'admin@test', NOW);
		assert.deepEqual(await startReaperLoop(env, ID, 'abandoned', { reason: 'sweep', now: NOW }), { started: false, why: 'kept by an admin' });
	});

	it('failures retry with backoff, then flag the item failed and dead-letter', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(placeholder()));
		await startReaperLoop(env, ID, 'abandoned', { reason: 'a', now: NOW });
		const body = env.PROCESSING_CHECK_QUEUE.sent[0].body;
		bunny.failGet = 100;
		const retried: (number | undefined)[] = [];
		for (const attempts of [1, REAPER_MAX_DELIVERIES]) {
			await handleReaperBatch({ messages: [{ body, attempts, ack: () => assert.fail('acked a failure'), retry: (o?: { delaySeconds?: number }) => retried.push(o?.delaySeconds) }] }, env);
			const item = env.global_settings.read(itemKey(ID));
			assert.equal(item.status, attempts === REAPER_MAX_DELIVERIES ? 'failed' : 'checking');
			assert.match(item.lastError, /503/);
		}
		assert.deepEqual(retried, [reaperRetryDelaySeconds(1), reaperRetryDelaySeconds(REAPER_MAX_DELIVERIES)]);
		assert.deepEqual([1, 2, 3, 4, 5, 6].map(reaperRetryDelaySeconds), [60, 240, 960, 3600, 3600, 3600]);
	});

	it('malformed messages are acked and dropped', async () => {
		let acked = 0;
		await handleReaperBatch({ messages: [{ body: { kind: REAPER_KIND }, attempts: 1, ack: () => acked++, retry: () => assert.fail() }] }, makeEnv());
		assert.equal(acked, 1);
	});
});

describe('sweepStaleUploads', () => {
	let bunny: ReturnType<typeof bunnyStub>;
	beforeEach(() => {
		bunny = bunnyStub();
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('enqueues abandoned records and orphans of this environment, once', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(placeholder()));
		await env.videos.put('fresh-0001', JSON.stringify(placeholder({ id: 'fresh-0001', dateCreated: ago(H), dateModified: ago(H) })));
		await env.videos.put('ready-0001', JSON.stringify(placeholder({ id: 'ready-0001', uploadStatus: 'ready' })));
		bunny.videos.set(ID, { guid: ID, title: 'Lecture', status: 0, dateUploaded: ago(30 * H) });
		bunny.videos.set(ORPHAN, { guid: ORPHAN, title: 'Orphan', status: 0, dateUploaded: ago(30 * H) });
		const stageOrphan = '88888888-2222-4333-8444-555555555555';
		bunny.videos.set(stageOrphan, { guid: stageOrphan, title: '[stage] Orphan', status: 0, dateUploaded: ago(30 * H) });
		const readyOrphan = '77777777-2222-4333-8444-555555555555';
		bunny.videos.set(readyOrphan, { guid: readyOrphan, title: 'Ready', status: 4, dateUploaded: ago(30 * H) });

		const stats = await sweepStaleUploads(env, { now: NOW });
		assert.equal(stats.abandonedCandidates, 1);
		assert.equal(stats.orphanCandidates, 1);
		assert.equal(stats.loopsStarted, 2);
		assert.equal(stats.mode, 'dry-run');
		const targets = env.PROCESSING_CHECK_QUEUE.sent.map((m: any) => `${m.body.target}:${m.body.videoId}`).sort();
		assert.deepEqual(targets, [`abandoned:${ID}`, `orphan:${ORPHAN}`]);

		const again = await sweepStaleUploads(env, { now: NOW });
		assert.equal(again.loopsStarted, 0, 'live loops are not started twice');
		assert.equal(bunny.deleted.length, 0, 'the sweep itself never deletes');
	});

	it('walks every library: an empty entry left in the legacy library is found (#1163)', async () => {
		const env = { ...makeEnv(), BUNNY_LEGACY_LIBRARY_ID: LEGACY_LIBRARY, BUNNY_LEGACY_STREAM_KEY: 'legacy-key' };
		const empty = '66666666-2222-4333-8444-555555555555';
		bunny.legacy.set(empty, { guid: empty, title: 'Lecture 3', status: 0, storageSize: 0, length: 0, dateUploaded: ago(8 * 24 * H) });
		const stats = await sweepStaleUploads(env, { now: NOW });
		assert.equal(stats.orphanCandidates, 1);
		assert.deepEqual(env.PROCESSING_CHECK_QUEUE.sent.map((m: any) => `${m.body.target}:${m.body.videoId}`), [`orphan:${empty}`]);
		assert.equal(stats.nextBunnyPages?.[LEGACY_LIBRARY], 1, 'the legacy library has its own page');
	});
});
