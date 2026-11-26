/**
 * Unified online Event Calendar & RFC 5545 (.ics) endpoints (Epic 22, E22-D7):
 * - 404 feature_off when `eventCalendar` switch is off (covered by feature-routes.spec.ts too)
 * - Reads `live_stream_metadata` (and falls back cleanly to `content_ownership` before E17-1)
 * - Filters by `channelId`, `eventType`, `kind`, `subscribedOnly`, `from`/`to`, hiding private/deleted/hidden items
 * - Populates `viewerReminded` from `NOTIFICATIONS_DB.live_reminders`
 * - Serves valid RFC 5545 `text/calendar` on `GET /api/events.ics` and `GET /api/channels/:channelId/events.ics`
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches, writeFeatureSwitch } from '@al-ummah/shared-types';
import {
	ChannelEventsCalendarIcs,
	EventsCalendarIcs,
	EventsCalendarList,
} from '../src/endpoints/events/eventsCalendar';
import { listCalendarEvents } from '../src/lib/events/calendar';
import { MemoryBucket, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 as createNotificationsD1 } from './sqlite-d1';

function registerRoutes(r: any) {
	r.get('/api/events', EventsCalendarList);
	r.get('/api/events.ics', EventsCalendarIcs);
	r.get('/api/channels/:channelId/events.ics', ChannelEventsCalendarIcs);
}

function seedEnv(withE17Tables = true) {
	const searchDb = new SqliteD1();
	const notificationsDb = createNotificationsD1();
	const enableSwitch = searchDb.db
		.prepare("INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES (?, 1, 1, 'test', '2026-11-23T00:00:00Z')");
	for (const key of ['eventCalendar', 'liveEvents', 'livePremieres']) enableSwitch.run(key);
	forgetFeatureSwitches();

	if (withE17Tables) {
		const insertMeta = searchDb.db.prepare(`
			INSERT INTO live_stream_metadata (stream_id, channel_id, owner_id, kind, premiere_video_id, event_type, status, visibility, scheduled_start_at, started_at, ended_at, reminder_count, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		// 1. Currently live stream on ch-1
		insertMeta.run('ls-live', 'ch-1', 'owner-1', 'live', null, 'jumuah', 'live', 'public', Date.parse('2026-11-27T12:00:00Z'), Date.parse('2026-11-27T12:01:00Z'), null, 5, 100, 100);
		// 2. Scheduled halqa on ch-1
		insertMeta.run('ls-halqa', 'ch-1', 'owner-1', 'live', null, 'halqa', 'scheduled', 'public', Date.parse('2026-11-28T18:00:00Z'), null, null, 12, 101, 101);
		// 3. Scheduled premiere on ch-2 (premieres link to /live/<streamId>)
		insertMeta.run('ls-premiere', 'ch-2', 'owner-2', 'premiere', 'vid-prem-1', 'conference', 'scheduled', 'public', Date.parse('2026-11-29T19:00:00Z'), null, null, 3, 102, 102);
		// 4. Non-public streams in live_stream_metadata (must never appear)
		insertMeta.run('ls-private', 'ch-1', 'owner-1', 'live', null, 'halqa', 'scheduled', 'private', Date.parse('2026-11-28T16:00:00Z'), null, null, 0, 103, 103);
		insertMeta.run('ls-hidden-meta', 'ch-1', 'owner-1', 'live', null, 'halqa', 'scheduled', 'hidden', Date.parse('2026-11-28T17:00:00Z'), null, null, 0, 104, 104);

		notificationsDb.raw
			.prepare("INSERT INTO live_reminders (stream_id, user_id, created_at) VALUES ('ls-halqa', 'viewer-1', 100)")
			.run();
	} else {
		// Pre-E17 fallback: drop live_stream_metadata and mark content_ownership (kind = 'stream') complete
		searchDb.db.exec('DROP TABLE IF EXISTS live_stream_metadata;');
		searchDb.db
			.prepare("INSERT INTO search_meta (key, value, updated_at) VALUES ('ownership:complete:stream', '1', 100)")
			.run();
		searchDb.db
			.prepare(`
				INSERT INTO content_ownership (kind, id, owner_id, channel_id, is_public, is_deleted, is_hidden, status, created_at, updated_at)
				VALUES
					('stream', 'ls-live', 'owner-1', 'ch-1', 1, 0, 0, 'live', 100, 100),
					('stream', 'ls-halqa', 'owner-1', 'ch-1', 1, 0, 0, 'scheduled', 101, 101),
					('stream', 'ls-premiere', 'owner-2', 'ch-2', 1, 0, 0, 'scheduled', 102, 102)
			`)
			.run();
	}

	notificationsDb.raw
		.prepare("INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES ('ch-1', 'sub-ch', 'viewer-1', 'sub-1', 100)")
		.run();

	const channels = new MemoryBucket({
		'ch-1': { id: 'ch-1', userId: 'owner-1', name: 'Masjid Al-Noor', nameLocalized: { ar: 'مسجد النور' }, handle: 'alnoor' },
		'ch-2': { id: 'ch-2', userId: 'owner-2', name: 'Qalam Institute', handle: 'qalam' },
		'ch-hidden': { id: 'ch-hidden', userId: 'owner-3', name: 'Hidden', isHidden: true },
	});

	const videos = new MemoryBucket({
		'livestream:ls-live': {
			id: 'ls-live',
			channelId: 'ch-1',
			userId: 'owner-1',
			title: 'Friday Khutbah',
			status: 'live',
			eventType: 'jumuah',
			scheduledStartTime: '2026-11-27T12:00:00.000Z',
			actualStartTime: '2026-11-27T12:01:00.000Z',
		},
		'livestream:ls-halqa': {
			id: 'ls-halqa',
			channelId: 'ch-1',
			userId: 'owner-1',
			title: 'Tafsir Surah Yasin',
			description: 'Weekly online study session.',
			status: 'scheduled',
			eventType: 'halqa',
			scheduledStartTime: '2026-11-28T18:00:00.000Z',
		},
		'livestream:ls-premiere': {
			id: 'ls-premiere',
			channelId: 'ch-2',
			userId: 'owner-2',
			title: 'Seerah Documentary Premiere',
			status: 'scheduled',
			kind: 'premiere',
			premiereVideoId: 'vid-prem-1',
			eventType: 'conference',
			scheduledStartTime: '2026-11-29T19:00:00.000Z',
		},
		'livestream:ls-private': {
			id: 'ls-private',
			channelId: 'ch-1',
			userId: 'owner-1',
			title: 'Private Rehearsal',
			status: 'scheduled',
			isPrivate: true,
			scheduledStartTime: '2026-11-28T16:00:00.000Z',
		},
		'livestream:ls-hidden-meta': {
			id: 'ls-hidden-meta',
			channelId: 'ch-1',
			userId: 'owner-1',
			title: 'Metadata Hidden Stream',
			status: 'scheduled',
			scheduledStartTime: '2026-11-28T17:00:00.000Z',
		},
	});

	return {
		SEARCH_DB: searchDb as unknown as D1Database,
		NOTIFICATIONS_DB: notificationsDb as unknown as D1Database,
		channels,
		videos,
		SITE_URL: 'https://videos.alummahnow.net',
	} as any;
}

async function updateR2(bucket: MemoryBucket, key: string, fields: Record<string, unknown>) {
	const existing = await bucket.get(key);
	assert.ok(existing);
	await bucket.put(key, JSON.stringify({ ...(await existing.json()), ...fields }));
}

describe('Event Calendar & .ics endpoints (E22-S3)', () => {
	beforeEach((t) => {
		t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-26T12:00:00Z') });
	});

	it('lists live and scheduled online events in order, hiding private streams and populating viewerReminded', async () => {
		const e = seedEnv(true);
		const app = buildApp(registerRoutes, { userId: 'viewer-1' });
		const res = await app.request('/api/events', {}, e);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.deepEqual(
			body.result.items.map((i: any) => [i.streamId, i.kind, i.eventType, i.viewerReminded, i.watchPath]),
			[
				['ls-live', 'live', 'jumuah', false, '/live/ls-live'],
				['ls-halqa', 'live', 'halqa', true, '/live/ls-halqa'],
				['ls-premiere', 'premiere', 'conference', false, '/live/ls-premiere'],
			],
		);
	});

	it('filters by eventType, kind, subscribedOnly, and date bounds', async () => {
		const e = seedEnv(true);
		const app = buildApp(registerRoutes, { userId: 'viewer-1' });

		const halqas = ((await (await app.request('/api/events?eventType=halqa', {}, e)).json()) as any).result.items;
		assert.deepEqual(halqas.map((i: any) => i.streamId), ['ls-halqa']);

		const premieres = ((await (await app.request('/api/events?kind=premiere', {}, e)).json()) as any).result.items;
		assert.deepEqual(premieres.map((i: any) => i.streamId), ['ls-premiere']);

		const subbed = ((await (await app.request('/api/events?subscribedOnly=true', {}, e)).json()) as any).result.items;
		assert.deepEqual(subbed.map((i: any) => i.streamId), ['ls-live', 'ls-halqa']);

		assert.equal((await app.request('/api/events?from=not-a-date', {}, e)).status, 400);
	});

	it('falls back cleanly to content_ownership when live_stream_metadata is not migrated yet', async () => {
		const e = seedEnv(false);
		const app = buildApp(registerRoutes);
		const res = await app.request('/api/events', {}, e);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.deepEqual(body.result.items.map((i: any) => i.streamId), ['ls-live', 'ls-halqa', 'ls-premiere']);
	});

	it('uses the partial index without scans or a sort for each fallback query before and after ANALYZE', async () => {
		const e = seedEnv(false);
		const searchDb: SqliteD1 = e.SEARCH_DB;
		searchDb.db.exec(`
			WITH RECURSIVE sample(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM sample WHERE n < 5000)
			INSERT INTO content_ownership (kind, id, owner_id, channel_id, is_public, is_deleted, is_hidden, status, created_at, updated_at)
			SELECT 'stream', 'ended-' || n, 'owner-1', 'ch-' || (n % 3 + 1), 1, 0, 0, 'ended', n + 100, n + 100
			FROM sample;
		`);
		e.NOTIFICATIONS_DB.raw.exec(`
			INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at)
			VALUES ('ch-2', 'sub-ch', 'viewer-1', 'sub-2', 101);
		`);
		for (const analyzed of [false, true]) {
			if (analyzed) searchDb.db.exec('ANALYZE');
			for (const options of [{}, { channelId: 'ch-1' }, { subscribedOnly: true, viewerId: 'viewer-1' }]) {
				searchDb.trace = [];
				await listCalendarEvents(e, options);
				const query = searchDb.trace.find(({ sql }) => sql.includes('SELECT id FROM content_ownership'));
				assert.ok(query);
				assert.deepEqual(searchDb.plan(query), [
					'SEARCH content_ownership USING INDEX idx_content_ownership_kind_status_created (kind=?)',
				]);
			}
		}
	});

	for (const withMetadata of [true, false]) {
		const source = withMetadata ? 'metadata' : 'fallback';

		for (const fields of [
			{ isPrivate: true },
			{ isHidden: true },
			{ isDeleted: true },
			{ review: { status: 'in_review' } },
			{ csamTakedown: true },
			{ status: 'ended' },
			{ status: 'cancelled' },
		]) {
			it(`excludes a stream from the ${source} feed when R2 has ${JSON.stringify(fields)}`, async () => {
				const e = seedEnv(withMetadata);
				await updateR2(e.videos, 'livestream:ls-halqa', fields);
				const app = buildApp(registerRoutes);
				const res = await app.request('/api/events', {}, e);
				assert.equal(res.status, 200);
				const body = (await res.json()) as any;
				assert.deepEqual(body.result.items.map((i: any) => i.streamId), ['ls-live', 'ls-premiere']);
			});
		}

		for (const flag of ['isSuspended', 'markedForDeletion']) {
			it(`excludes a channel from the ${source} feed when R2 has ${flag}`, async () => {
				const e = seedEnv(withMetadata);
				await updateR2(e.channels, 'ch-1', { [flag]: true });
				const app = buildApp(registerRoutes);
				const res = await app.request('/api/events', {}, e);
				assert.equal(res.status, 200);
				const body = (await res.json()) as any;
				assert.deepEqual(body.result.items.map((i: any) => i.streamId), ['ls-premiere']);
				assert.equal((await app.request('/api/channels/ch-1/events.ics', {}, e)).status, 404);
			});
		}

		it(`hides scheduled premieres from the ${source} JSON and .ics feeds while livePremieres is off`, async () => {
			const e = seedEnv(withMetadata);
			e.SEARCH_DB.db.exec("UPDATE feature_switches SET enabled = 0 WHERE key = 'livePremieres'");
			const app = buildApp(registerRoutes);
			const res = await app.request('/api/events', {}, e);
			assert.equal(res.status, 200);
			const body = (await res.json()) as any;
			assert.deepEqual(body.result.items.map((i: any) => i.streamId), ['ls-live', 'ls-halqa']);
			const ics = await app.request('/api/events.ics', {}, e);
			assert.equal(ics.status, 200);
			assert.doesNotMatch(await ics.text(), /UID:live-ls-premiere/);
		});

		it(`hides tagged events from the ${source} JSON and .ics feeds while liveEvents is off`, async () => {
			const e = seedEnv(withMetadata);
			e.FEATURES_FORCE_OFF = 'liveEvents';
			if (withMetadata) e.SEARCH_DB.db.exec("UPDATE live_stream_metadata SET event_type = NULL WHERE stream_id = 'ls-live'");
			await updateR2(e.videos, 'livestream:ls-live', { eventType: null });
			const app = buildApp(registerRoutes);
			const res = await app.request('/api/events', {}, e);
			assert.equal(res.status, 200);
			const body = (await res.json()) as any;
			assert.deepEqual(body.result.items.map((i: any) => i.streamId), ['ls-live']);

			const filtered = await app.request('/api/events?eventType=halqa', {}, e);
			assert.equal(filtered.status, 200);
			assert.deepEqual(((await filtered.json()) as any).result.items, []);

			const ics = await app.request('/api/channels/ch-1/events.ics', {}, e);
			assert.equal(ics.status, 200);
			const feed = await ics.text();
			assert.match(feed, /UID:live-ls-live/);
			assert.doesNotMatch(feed, /UID:live-ls-halqa/);
		});
	}

	it('uses a newer active R2 status when D1 still says scheduled', async () => {
		const e = seedEnv();
		await updateR2(e.videos, 'livestream:ls-halqa', { status: 'live' });
		const { items } = await listCalendarEvents(e, { eventType: 'halqa' });
		assert.deepEqual(items.map(({ streamId, status }) => [streamId, status]), [['ls-halqa', 'live']]);
	});

	it('serves RFC 5545 text/calendar feeds globally and per channel, and 404s hidden/missing channels', async () => {
		const e = seedEnv(true);
		const app = buildApp(registerRoutes);

		const globalRes = await app.request('/api/events.ics', {}, e);
		assert.equal(globalRes.status, 200);
		assert.match(globalRes.headers.get('content-type') ?? '', /text\/calendar/);
		const globalIcs = (await globalRes.text()).replace(/\r\n /g, '');
		assert.match(globalIcs, /UID:live-ls-halqa@alummahnow\.net/);
		assert.match(globalIcs, /UID:live-ls-premiere@alummahnow\.net/);
		assert.doesNotMatch(globalIcs, /ls-private/);

		const chRes = await app.request('/api/channels/ch-1/events.ics', {}, e);
		assert.equal(chRes.status, 200);
		const chIcs = (await chRes.text()).replace(/\r\n /g, '');
		assert.match(chIcs, /X-WR-CALNAME:Masjid Al-Noor — Upcoming Events/);
		assert.match(chIcs, /UID:live-ls-halqa@alummahnow\.net/);
		assert.doesNotMatch(chIcs, /UID:live-ls-premiere@alummahnow\.net/);

		assert.equal((await app.request('/api/channels/ch-hidden/events.ics', {}, e)).status, 404);
		assert.equal((await app.request('/api/channels/missing/events.ics', {}, e)).status, 404);
	});

	it('returns 404 feature_off on all three endpoints when eventCalendar switch is off', async () => {
		const e = seedEnv(true);
		await writeFeatureSwitch(e, { key: 'eventCalendar', enabled: false, expectedVersion: 1, actorId: 'usr_admin', currentStored: true });
		forgetFeatureSwitches();
		const app = buildApp(registerRoutes);

		for (const path of ['/api/events', '/api/events.ics', '/api/channels/ch-1/events.ics']) {
			const res = await app.request(path, {}, e);
			assert.equal(res.status, 404, path);
			assert.equal(((await res.json()) as any).code, 'feature_off');
		}
		forgetFeatureSwitches();
	});

	it('paginates cleanly across private rows without skipping or duplicating items, excludes stale unstarted scheduled streams, and sets Cache-Control', async () => {
		const e = seedEnv(true);
		// Add a stale unstarted scheduled stream from 3 days ago (must be excluded by default 6h grace window)
		(e.SEARCH_DB as any).db
			.prepare(`INSERT INTO live_stream_metadata (stream_id, channel_id, owner_id, kind, premiere_video_id, event_type, status, visibility, scheduled_start_at, started_at, ended_at, reminder_count, created_at, updated_at)
			          VALUES ('ls-stale', 'ch-1', 'owner-1', 'live', null, 'halqa', 'scheduled', 'public', ?, null, null, 0, 90, 90)`)
			.run(Date.now() - 3 * 86_400_000);
		await e.videos.put('livestream:ls-stale', JSON.stringify({
			id: 'ls-stale',
			channelId: 'ch-1',
			userId: 'owner-1',
			title: 'Stale Stream',
			status: 'scheduled',
			scheduledStartTime: new Date(Date.now() - 3 * 86_400_000).toISOString(),
		}));

		const anonApp = buildApp(registerRoutes);
		const page1Res = await anonApp.request('/api/events?limit=2', {}, e);
		assert.equal(page1Res.status, 200);
		assert.equal(page1Res.headers.get('cache-control'), 'public, max-age=60');
		const page1 = ((await page1Res.json()) as any).result;
		assert.deepEqual(page1.items.map((i: any) => i.streamId), ['ls-live', 'ls-halqa']);
		assert.ok(page1.nextCursor, 'expects nextCursor after 2 of 3 public items even with ls-private interleaved');

		const page2Res = await anonApp.request(`/api/events?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, {}, e);
		const page2 = ((await page2Res.json()) as any).result;
		assert.deepEqual(page2.items.map((i: any) => i.streamId), ['ls-premiere']);
		assert.equal(page2.nextCursor, null);
	});

	it('localizes .ics feeds into Arabic via ?lang=ar and Accept-Language', async () => {
		const e = seedEnv(true);
		const app = buildApp(registerRoutes);

		const json = await app.request('/api/events?channelId=ch-1', {}, e);
		assert.equal(json.status, 200);
		const { result } = (await json.json()) as any;
		assert.deepEqual(result.items.map((item: any) => item.channelNameAr), ['مسجد النور', 'مسجد النور']);

		const arGlobal = (await (await app.request('/api/events.ics?lang=ar', { headers: { 'Accept-Language': 'en' } }, e)).text()).replace(/\r\n /g, '');
		assert.match(arGlobal, /PRODID:-\/\/Al Ummah Now\/\/Event Calendar\/\/AR/);
		assert.match(arGlobal, /X-WR-CALNAME:الأمة الآن — الفعاليات القادمة/);
		assert.match(arGlobal, /SUMMARY:Tafsir Surah Yasin — مسجد النور/);

		const arChannel = (await (await app.request('/api/channels/ch-1/events.ics', { headers: { 'Accept-Language': 'ar-SA,ar;q=0.9' } }, e)).text()).replace(/\r\n /g, '');
		assert.match(arChannel, /X-WR-CALNAME:مسجد النور — الفعاليات القادمة/);
	});

	it('ranks supported Accept-Language ranges by quality and breaks ties by header order', async () => {
		const e = seedEnv();
		const app = buildApp(registerRoutes);
		for (const [header, locale] of [
			['en-US,en;q=0.9,ar;q=0.5', 'EN'],
			['ar;q=0', 'EN'],
			['en;q=0.4, AR-SA; q=0.9', 'AR'],
			['ar;q=0.8,en;q=0.8', 'AR'],
			['en;q=0.8,ar;q=0.8', 'EN'],
		]) {
			const res = await app.request('/api/events.ics', { headers: { 'Accept-Language': header } }, e);
			assert.equal(res.status, 200);
			assert.ok((await res.text()).includes(`//Event Calendar//${locale}\r\n`), header);
		}
	});

});
