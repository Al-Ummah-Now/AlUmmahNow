import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_ERASED_MARKER, ARCHIVE_PRIVACY_VERSION, MessageType } from '@al-ummah/shared-types';
import {
	ARCHIVE_PRIVACY_REWRITE_KIND,
	archivePrefixes,
	handleArchivePrivacyMessage,
	runArchivePrivacyPage,
	type ArchivePrivacyMessage,
} from '../src/lib/archivePrivacyRewrite';

/**
 * #1177: the archive entries written before pseudonymisation are rewritten once: no raw user id, no
 * free text, per-person copies deleted; a dry run writes nothing; the run's key is gone at the end.
 */

const ALICE = 'usr_0123456789abcdef0123456789abcdef';

/** R2 stand-in with customMetadata and prefix listing (sorted keys, key cursor). */
class ArchiveBucket {
	store = new Map<string, { body: string; customMetadata?: Record<string, string> }>();
	writes = 0;
	set(key: string, value: unknown, customMetadata?: Record<string, string>) {
		this.store.set(key, { body: typeof value === 'string' ? value : JSON.stringify(value), customMetadata });
	}
	json(key: string) {
		return JSON.parse(this.store.get(key)!.body);
	}
	async get(key: string) {
		const o = this.store.get(key);
		if (!o) return null;
		return { key, customMetadata: o.customMetadata, httpMetadata: { contentType: 'application/json' }, text: async () => o.body, json: async () => JSON.parse(o.body) };
	}
	async put(key: string, body: string, options?: { customMetadata?: Record<string, string> }) {
		this.writes++;
		this.store.set(key, { body, customMetadata: options?.customMetadata });
		return { key };
	}
	async delete(keys: string | string[]) {
		this.writes++;
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
	async list(opts: { prefix?: string; limit?: number; cursor?: string }) {
		const keys = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort().filter((k) => !opts.cursor || k > opts.cursor);
		const page = keys.slice(0, opts.limit ?? 1000);
		const truncated = keys.length > page.length;
		return { objects: page.map((key) => ({ key, customMetadata: this.store.get(key)!.customMetadata })), truncated, cursor: truncated ? page[page.length - 1] : undefined };
	}
}

function seed(bucket: ArchiveBucket, day: string) {
	bucket.set(`${day}T10-00-00.a`, { id: 'a', type: MessageType.ReportCreate, payload: { reporterId: ALICE, description: 'my private words', reason: 'spam' } });
	bucket.set(`${day}T10-00-01.b`, { id: 'b', type: MessageType.VideoView, payload: { viewerId: ALICE, videoId: 'v1' } });
	bucket.set(`${day}T10-00-02.c`, { id: 'c', type: MessageType.UserDataErased, payload: { userId: ALICE } });
	bucket.set(`${day}T10-00-03.d`, { id: 'd', type: MessageType.VideoCreate, payload: { videoId: 'v2' } });
	bucket.set(`${day}T10-00-04.e`, { id: 'e', payload: { userId: 'ps_' + '1'.repeat(32) }, privacy: ARCHIVE_PRIVACY_VERSION }, { privacy: ARCHIVE_PRIVACY_VERSION });
	bucket.set(`${day}T10-00-05.f`, 'not json');
	bucket.set(`analytics/tabs/user-behavior/${ALICE}/1.json`, { userId: ALICE });
}

describe('archive privacy rewrite', () => {
	it('dry run counts and writes nothing', async () => {
		const bucket = new ArchiveBucket();
		seed(bucket, '2026-11-01');
		const day = await runArchivePrivacyPage(bucket as never, { dryRun: true, key: null, limit: 100 }, '2026-11-01', null);
		assert.deepEqual(day.counts, { listed: 6, stamped: 1, clean: 1, rewritten: 3, deleted: 0, unreadable: 1 });
		const copies = await runArchivePrivacyPage(bucket as never, { dryRun: true, key: null, limit: 100 }, 'analytics/tabs/user-behavior/', null);
		assert.equal(copies.counts.deleted, 1);
		assert.equal(bucket.writes, 0);
	});

	it('rewrites with a run key: one pseudonym per person, no raw id or free text, erasures marked', async () => {
		const bucket = new ArchiveBucket();
		seed(bucket, '2026-11-01');
		const meta = { dryRun: false, key: 'k'.repeat(64), limit: 2 };
		let cursor: string | null = null;
		do {
			({ nextCursor: cursor } = await runArchivePrivacyPage(bucket as never, meta, '2026-11-01', cursor));
		} while (cursor);
		await runArchivePrivacyPage(bucket as never, meta, 'analytics/tabs/user-behavior/', null);
		const all = JSON.stringify([...bucket.store.values()]);
		assert.ok(!all.includes(ALICE), 'no raw user id left');
		assert.ok(!all.includes('my private words'), 'no free text left');
		const report = bucket.json('2026-11-01T10-00-00.a');
		const view = bucket.json('2026-11-01T10-00-01.b');
		assert.match(report.payload.reporterId, /^ps_[0-9a-f]{32}$/);
		assert.equal(view.payload.viewerId, report.payload.reporterId, 'the same person keeps one pseudonym within the run');
		assert.equal(bucket.json('2026-11-01T10-00-02.c').payload.userId, ARCHIVE_ERASED_MARKER);
		assert.equal(bucket.store.get('2026-11-01T10-00-00.a')!.customMetadata?.privacy, ARCHIVE_PRIVACY_VERSION);
		assert.equal(bucket.store.get('2026-11-01T10-00-05.f')!.body, 'not json');
	});

	it('runs a whole job in lanes and deletes its key at the end', async () => {
		const bucket = new ArchiveBucket();
		const now = new Date('2026-11-13T12:00:00Z');
		seed(bucket, '2026-11-12');
		const settings = new ArchiveBucket();
		const queue: ArchivePrivacyMessage[] = [];
		const env = { analytics_rollups: bucket, global_settings: settings, PROCESSING_CHECK_QUEUE: { send: async (m: ArchivePrivacyMessage) => void queue.push(m) } };
		queue.push({ kind: ARCHIVE_PRIVACY_REWRITE_KIND, runId: 'archive-privacy-test-1', lane: 0, prefixIndex: 0, cursor: null, start: { dryRun: false, lanes: 3, limit: 50 } });
		let steps = 0;
		while (queue.length && steps++ < 2000) {
			const body = queue.shift()!;
			let acked = false;
			await handleArchivePrivacyMessage(env as never, { body, attempts: 1, ack: () => void (acked = true), retry: () => assert.fail('no retry expected') }, now);
			assert.ok(acked);
		}
		assert.equal(queue.length, 0);
		const meta = settings.json('ops/archive-privacy/runs/archive-privacy-test-1/meta.json');
		assert.equal(meta.key, null, 'the run key is deleted once every lane is done');
		assert.equal(meta.prefixes.length, archivePrefixes(now).length);
		const lanes = [0, 1, 2].map((l) => settings.json(`ops/archive-privacy/runs/archive-privacy-test-1/lane-${l}.json`));
		assert.ok(lanes.every((l) => l.status === 'done'));
		const rewritten = lanes.reduce((n, l) => n + Object.values(l.prefixes as Record<string, { rewritten: number }>).reduce((m, c) => m + c.rewritten, 0), 0);
		assert.equal(rewritten, 3);
		assert.ok(!JSON.stringify([...bucket.store.values()]).includes(ALICE));
	});
	it('a redelivered page never forks its lane: every object is read once (QA 2026-11-13, GetObject climbing hourly)', async () => {
		const bucket = new ArchiveBucket();
		const now = new Date('2026-11-13T12:00:00Z');
		for (let i = 0; i < 12; i++) bucket.set(`2026-11-12T10-00-${String(i).padStart(2, '0')}.x`, { id: String(i), type: MessageType.VideoView, payload: { viewerId: ALICE, videoId: 'v1' } });
		let reads = 0;
		const get = bucket.get.bind(bucket);
		bucket.get = async (key: string) => (reads++, get(key));
		const settings = new ArchiveBucket();
		const queue: ArchivePrivacyMessage[] = [];
		const env = { analytics_rollups: bucket, global_settings: settings, PROCESSING_CHECK_QUEUE: { send: async (m: ArchivePrivacyMessage) => void queue.push(m) } };
		queue.push({ kind: ARCHIVE_PRIVACY_REWRITE_KIND, runId: 'archive-privacy-dup-1', lane: 0, prefixIndex: 0, cursor: null, start: { dryRun: true, lanes: 1, limit: 5 } });
		let steps = 0;
		while (queue.length && steps++ < 5000) {
			const body = queue.shift()!;
			// At-least-once delivery: every message arrives twice, the copy after the original was handled
			for (let copy = 0; copy < 2; copy++) {
				let acked = false;
				await handleArchivePrivacyMessage(env as never, { body, attempts: 1, ack: () => void (acked = true), retry: () => assert.fail('no retry expected') }, now);
				assert.ok(acked, 'a duplicate is acked, never retried');
			}
		}
		assert.equal(queue.length, 0);
		const lane = settings.json('ops/archive-privacy/runs/archive-privacy-dup-1/lane-0.json');
		assert.equal(lane.status, 'done');
		assert.equal(lane.prefixes['2026-11-12'].listed, 12, 'each object listed once, not once per fork');
		assert.equal(reads, 12, 'each object read once');
	});
	it('a page whose next message failed to send is retried into the next page, never stalled', async () => {
		const bucket = new ArchiveBucket();
		const now = new Date('2026-11-13T12:00:00Z');
		for (let i = 0; i < 12; i++) bucket.set(`2026-11-12T10-00-${String(i).padStart(2, '0')}.x`, { id: String(i), type: MessageType.VideoView, payload: { viewerId: ALICE, videoId: 'v1' } });
		const settings = new ArchiveBucket();
		const queue: ArchivePrivacyMessage[] = [];
		let failSends = 1;
		const send = async (m: ArchivePrivacyMessage) => {
			// The first continuation (only the seeded day has one) fails once, after the lane was saved
			if (m.cursor && failSends-- > 0) throw new Error('queue unavailable');
			queue.push(m);
		};
		const env = { analytics_rollups: bucket, global_settings: settings, PROCESSING_CHECK_QUEUE: { send } };
		const work: { body: ArchivePrivacyMessage; attempts: number }[] = [{ body: { kind: ARCHIVE_PRIVACY_REWRITE_KIND, runId: 'archive-privacy-retry-1', lane: 0, prefixIndex: 0, cursor: null, start: { dryRun: true, lanes: 1, limit: 5 } }, attempts: 1 }];
		let steps = 0;
		while ((work.length || queue.length) && steps++ < 2000) {
			const item = work.shift() ?? { body: queue.shift()!, attempts: 1 };
			await handleArchivePrivacyMessage(env as never, { body: item.body, attempts: item.attempts, ack: () => undefined, retry: () => void work.push({ body: item.body, attempts: item.attempts + 1 }) }, now);
		}
		const lane = settings.json('ops/archive-privacy/runs/archive-privacy-retry-1/lane-0.json');
		assert.equal(lane.status, 'done', 'the lane finished');
		assert.equal(lane.prefixes['2026-11-12'].listed, 12);
	});
});
