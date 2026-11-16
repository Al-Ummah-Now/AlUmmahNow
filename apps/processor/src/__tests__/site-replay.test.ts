/**
 * Replay of the site counters lost before #1476 (#1477): archived ClientAnalyticsEvent records
 * become the same counters the live processor writes, exactly once, aggregates only.
 */
import { CounterBatch } from '../lib/analytics-counters';
import { REPLAY_MARKER_DIM, REPLAY_MARKER_METRIC, recordIncrements, replayDays, replaySiteCounters, type ArchiveBucket } from '../lib/site-replay';
import { MessageProcessor } from '../messageProcessor';
import { MessageType, type AlUmmahMessage, type QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const CUTOFF = '2026-11-16T02:30:00.000Z';

function archive() {
	const objects = new Map<string, { body: string; meta?: Record<string, string> }>();
	const reads: string[] = [];
	const bucket: ArchiveBucket & { reads: string[] } = {
		reads,
		list: async ({ prefix, cursor, limit = 1000 }) => {
			const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
			const start = cursor ? Number(cursor) : 0;
			const page = keys.slice(start, start + Math.min(limit, 2)); // tiny pages: pagination is exercised
			const next = start + page.length;
			return { objects: page.map((key) => ({ key, customMetadata: objects.get(key)!.meta })), truncated: next < keys.length, cursor: String(next) };
		},
		get: async (key) => {
			reads.push(key);
			const o = objects.get(key);
			return o ? { text: async () => o.body } : null;
		},
	};
	let n = 0;
	const put = (receivedAt: string, payload: Record<string, unknown>, meta: Record<string, string> | null = { messageType: 'ClientAnalyticsEvent' }) => {
		const key = `${receivedAt.slice(0, 10)}T${receivedAt.slice(11, 19).replace(/:/g, '-')}.m${n++}`;
		objects.set(key, { body: JSON.stringify({ id: key, typeName: 'ClientAnalyticsEvent', payload: { receivedAt, ...payload }, privacy: 'v1' }), meta: meta ?? undefined });
		return key;
	};
	return { bucket, put };
}

const visit = (landing: string, source: string, referrerHost?: string) => ({ kind: 'visit', events: [{ landing, source, ...(referrerHost ? { referrerHost } : {}) }] });

const siteRows = (db: ReturnType<typeof createSqliteD1>) =>
	db.raw
		.prepare(`SELECT entity_id, day, metric, dim, value FROM analytics_daily WHERE entity_type = 'site' ORDER BY entity_id, day, metric, dim`)
		.all()
		.map((r) => ({ ...r }));

describe('site counter replay (#1477)', () => {
	it('lists the days from the first one to the cutoff day', () => {
		expect(replayDays('2026-11-13', CUTOFF)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']);
	});

	it('keeps only counter increments of a record, never its other fields', () => {
		const { increments } = recordIncrements(
			{ payload: { kind: 'visit', receivedAt: '2026-11-14T10:00:00Z', events: [{ landing: 'home', source: 'direct', secret: 'x' }] } },
			Date.parse(CUTOFF),
		);
		expect(JSON.stringify(increments)).not.toContain('secret');
		expect(increments.map((i) => i.metric)).toEqual(['visits', 'landing', 'source']);
	});

	it('dry run counts per day and writes nothing; apply writes once; a second apply writes nothing', async () => {
		const db = createSqliteD1();
		const { bucket, put } = archive();
		put('2026-11-13T09:00:00.000Z', visit('watch', 'search:google', 'www.google.com'));
		put('2026-11-13T23:59:59.000Z', visit('home', 'direct'));
		put('2026-11-14T08:00:00.000Z', visit('home', 'social:x', 'x.com'));
		put('2026-11-14T08:00:01.000Z', { kind: 'short_link', events: [{ type: 'video', source: 'social:whatsapp' }] });
		put('2026-11-16T03:00:00.000Z', visit('home', 'direct')); // after the cutoff: counted live
		put('2026-11-14T09:00:00.000Z', { ...visit('home', 'direct'), userId: 'ps_abc' }); // carries a user id
		put('2026-11-14T09:30:00.000Z', { ...visit('home', 'direct'), userId: 'deleted-user' }); // erased user
		put('2026-11-14T10:00:00.000Z', { kind: 'performance', events: [{ lcp: 1 }] });
		const viewKey = put('2026-11-14T11:00:00.000Z', { viewerId: 'u1' }, { messageType: 'VideoView' }); // never read
		const oldKey = put('2026-11-14T12:00:00.000Z', visit('home', 'direct'), null); // unlabelled: never read
		const env = { MESSAGES_BUCKET: bucket, NOTIFICATIONS_DB: db };

		const dry = await replaySiteCounters(env, { cutoff: CUTOFF, apply: false });
		expect(siteRows(db)).toEqual([]);
		expect(dry).toMatchObject({ keysListed: 10, otherTypes: 1, unlabelled: 1, recordsRead: 8, afterCutoff: 1, skippedWithUser: 2, unreadable: 0 });
		expect(dry.days).toEqual([
			{ day: '2026-11-14', entityId: 'short-links', events: 1, alreadyReplayed: false, applied: false },
			{ day: '2026-11-13', entityId: 'videos', events: 2, alreadyReplayed: false, applied: false },
			{ day: '2026-11-14', entityId: 'videos', events: 1, alreadyReplayed: false, applied: false },
		].sort((a, b) => a.day.localeCompare(b.day) || a.entityId.localeCompare(b.entityId)));
		expect(bucket.reads).not.toContain(viewKey);
		expect(bucket.reads).not.toContain(oldKey);

		const applied = await replaySiteCounters(env, { cutoff: CUTOFF, apply: true });
		expect(applied.days.every((d) => d.applied && !d.alreadyReplayed)).toBe(true);
		const after = siteRows(db);
		expect(after.filter((r) => r.metric === 'visits')).toEqual([
			{ entity_id: 'videos', day: '2026-11-13', metric: 'visits', dim: '', value: 2 },
			{ entity_id: 'videos', day: '2026-11-14', metric: 'visits', dim: '', value: 1 },
		]);
		expect(after).toContainEqual({ entity_id: 'videos', day: '2026-11-13', metric: 'referrer_host', dim: 'www.google.com', value: 1 });
		expect(after).toContainEqual({ entity_id: 'short-links', day: '2026-11-14', metric: 'clicks', dim: '', value: 1 });
		expect(after).toContainEqual({ entity_id: 'videos', day: '2026-11-13', metric: REPLAY_MARKER_METRIC, dim: REPLAY_MARKER_DIM, value: 2 });

		const again = await replaySiteCounters(env, { cutoff: CUTOFF, apply: true });
		expect(again.days.every((d) => d.alreadyReplayed && !d.applied)).toBe(true);
		expect(siteRows(db)).toEqual(after);
	});

	it('adds to the live counts of the cutoff day without counting a live message twice', async () => {
		const db = createSqliteD1();
		const env = { NOTIFICATIONS_DB: db, MESSAGE_ARCHIVE: 'off' } as unknown as QueueEnvironment;
		// After the fix: one visit counted live on the cutoff day
		const live = new MessageProcessor({ debug() {}, info() {}, warn() {}, error() {} } as never);
		await live.processMessage(
			{ id: 'live', type: MessageType.ClientAnalyticsEvent, timestamp: '2026-11-16T03:00:00Z', payload: { kind: 'visit', receivedAt: '2026-11-16T03:00:00.000Z', events: [{ landing: 'home', source: 'direct' }] } } as unknown as AlUmmahMessage,
			env,
		);
		const { bucket, put } = archive();
		put('2026-11-16T01:00:00.000Z', visit('home', 'direct')); // lost before the fix
		put('2026-11-16T03:00:00.000Z', visit('home', 'direct')); // the live one, archived too
		await replaySiteCounters({ MESSAGES_BUCKET: bucket, NOTIFICATIONS_DB: db }, { cutoff: CUTOFF, apply: true });
		expect(siteRows(db).find((r) => r.metric === 'visits')).toEqual({ entity_id: 'videos', day: '2026-11-16', metric: 'visits', dim: '', value: 2 });
	});

	it('a batch with its marker in place writes nothing, even built before the marker existed (concurrent runs)', async () => {
		const db = createSqliteD1();
		const marker = { entityType: 'site' as const, entityId: 'videos', day: '2026-11-14', metric: REPLAY_MARKER_METRIC, dim: REPLAY_MARKER_DIM, value: 1 };
		const build = () => {
			const b = new CounterBatch();
			b.add({ entityType: 'site', entityId: 'videos', day: '2026-11-14', metric: 'visits', value: 1 });
			b.add({ entityType: 'site', entityId: 'videos', day: '2026-11-14', metric: 'source', dim: 'direct', value: 1, maxDims: 60 });
			return b.statementsUnless(db, marker);
		};
		const first = build();
		const second = build();
		await db.batch(first);
		await db.batch(second);
		expect(siteRows(db).filter((r) => r.metric !== REPLAY_MARKER_METRIC)).toEqual([
			{ entity_id: 'videos', day: '2026-11-14', metric: 'source', dim: 'direct', value: 1 },
			{ entity_id: 'videos', day: '2026-11-14', metric: 'visits', dim: '', value: 1 },
		]);
	});
});

describe('refused counter increments are reported, never silent', () => {
	it('CounterBatch tells the caller why', () => {
		const refused: string[] = [];
		const batch = new CounterBatch((inc, reason) => refused.push(`${inc.entityType}:${reason}`));
		expect(batch.add({ entityType: 'user' as never, entityId: 'x', day: '2026-11-15', metric: 'm', value: 1 })).toBe(false);
		expect(batch.add({ entityType: 'video', entityId: '', day: '2026-11-15', metric: 'm', value: 1 })).toBe(false);
		expect(batch.add({ entityType: 'video', entityId: 'v', day: '2026-11-15', metric: 'm', value: Number.NaN })).toBe(false);
		expect(batch.add({ entityType: 'video', entityId: 'v', day: '2026-11-15', metric: 'm', value: 0 })).toBe(false);
		expect(batch.add({ entityType: 'video', entityId: 'v', day: '2026-11-15', metric: 'm', value: 1 })).toBe(true);
		expect(refused).toEqual(['user:unknown_entity_type', 'video:invalid_key', 'video:invalid_value']);
	});

	it('the processor logs a refused increment as an error', () => {
		const errors: unknown[][] = [];
		const processor = new MessageProcessor({ debug() {}, info() {}, warn() {}, error: (...a: unknown[]) => errors.push(a) } as never);
		(processor as unknown as { counters: CounterBatch }).counters.add({ entityType: 'user' as never, entityId: 'x', day: '2026-11-15', metric: 'visits', value: 1 });
		expect(errors).toEqual([['Analytics increment refused', { reason: 'unknown_entity_type', entityType: 'user', entityId: 'x', metric: 'visits', day: '2026-11-15' }]]);
	});
});
