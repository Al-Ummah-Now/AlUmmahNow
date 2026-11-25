/**
 * End-to-end route enforcement of the `creatorTerms` switch across going live,
 * publishing, scheduling, premieres, and audio track uploads.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_ERROR_CODES, CURRENT_CREATOR_TERMS_VERSION, forgetFeatureSwitches } from '@al-ummah/shared-types';
import { LiveStreamIngestGet, LiveStreamStart } from '../src/endpoints/live/liveSession';
import { PremiereSwap, VideoPremiereCreate } from '../src/endpoints/live/premiere';
import { AudioTrackCreate } from '../src/endpoints/audio/audioTracks';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { VideoBulkUndo, VideoBulkUpdate } from '../src/endpoints/video/videoBulkUpdate';
import { VideoScheduleCreate } from '../src/endpoints/video/scheduleCreate';
import { VideoBulkSchedule } from '../src/endpoints/video/videoBulkStudio';
import { VideoSchedulePublishNow } from '../src/endpoints/video/schedulePublishNow';
import { recordCreatorTermsAcceptance } from '../src/lib/creatorTerms';
import { saveTier } from '../src/lib/creatorTiers';
import { withSearchSync } from '../src/lib/search/sync';
import { JobsQueue, MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;
const HOUR = 3_600_000;

function setSwitch(db: SqliteD1, key: string, on: boolean) {
	db.db
		.prepare(
			`INSERT OR REPLACE INTO feature_switches (key, enabled, version, updated_by, updated_at)
			 VALUES (?, ?, 1, 'test', '2026-11-24T00:00:00Z')`,
		)
		.run(key, on ? 1 : 0);
	forgetFeatureSwitches();
}

describe('creatorTerms enforcement on live start, publish, schedule, premiere, and audio tracks', () => {
	beforeEach(() => forgetFeatureSwitches());

	async function setup() {
		const db = new SqliteD1();
		const pending: Promise<unknown>[] = [];
		const kvStore = new Map<string, string>();
		const raw: Json = {
			SEARCH_DB: db,
			NOTIFICATIONS_DB: createSqliteD1(),
			ADMIN_JOBS_QUEUE: new JobsQueue(),
			queue: new MemoryQueue(),
			SCHEDULED_VIDEOS: new MemoryBucket(),
			global_settings: new MemoryBucket(),
			TUS_SESSIONS: {
				get: async (k: string, type?: string) => {
					const rawVal = kvStore.get(k);
					if (rawVal === undefined) return null;
					return type === 'json' ? JSON.parse(rawVal) : rawVal;
				},
				put: async (k: string, v: string) => {
					kvStore.set(k, v);
				},
			},
		};
		for (const b of ['videos', 'channels', 'profiles', 'playlists', 'community_posts', 'subtitles']) {
			raw[b] = new MemoryBucket();
		}
		const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) }) as Json;
		const settle = async () => {
			while (pending.length) await pending.shift();
		};
		await raw.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'owner', name: 'Channel', members: [] }));
		await saveTier(db as never, 'creator', { live: true, bulkSchedule: true, audioTracks: 4 }, 'test');
		db.db
			.prepare(
				"INSERT OR REPLACE INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('owner', 'creator', 'admin', 'test', '2026-11-01')",
			)
			.run();
		setSwitch(db, 'live', true);
		setSwitch(db, 'livePremieres', true);
		setSwitch(db, 'creatorTerms', true);

		// Draft/private video, already-public video, and scheduled live stream created before the switch turned on
		await env.videos.put(
			'v-draft',
			JSON.stringify({
				...videoFixture(),
				id: 'v-draft',
				userId: 'owner',
				channelId: 'ch1',
				isPublic: false,
				isDraft: true,
				uploadStatus: 'ready',
				duration: 600,
				width: 1920,
				height: 1080,
				title: 'Draft Lecture',
			}),
		);
		await env.videos.put(
			'v-public',
			JSON.stringify({
				...videoFixture(),
				id: 'v-public',
				userId: 'owner',
				channelId: 'ch1',
				isPublic: true,
				isDraft: false,
				uploadStatus: 'ready',
				duration: 600,
				width: 1920,
				height: 1080,
				title: 'Published Lecture',
			}),
		);
		await env.videos.put(
			'v-legacy-public',
			JSON.stringify({
				...videoFixture(),
				id: 'v-legacy-public',
				userId: 'owner',
				channelId: 'ch1',
				isPublic: undefined,
				isDraft: false,
				uploadStatus: 'ready',
				duration: 600,
				width: 1920,
				height: 1080,
				title: 'Legacy Public Lecture',
			}),
		);
		await env.videos.put(
			'livestream:s1',
			JSON.stringify({
				id: 's1',
				userId: 'owner',
				channelId: 'ch1',
				title: 'Pre-existing Stream',
				status: 'scheduled',
				isPrivate: false,
				createdAt: '2026-11-24T00:00:00Z',
			}),
		);
		await env.videos.put(
			'livestream:p1',
			JSON.stringify({
				id: 'p1',
				kind: 'premiere',
				videoId: 'v-public',
				userId: 'owner',
				channelId: 'ch1',
				title: 'Scheduled Premiere',
				status: 'scheduled',
				scheduledStartTime: new Date(Date.now() + 2 * HOUR).toISOString(),
				isPrivate: false,
				createdAt: '2026-11-24T00:00:00Z',
			}),
		);

		const app = buildApp(
			(r) => {
				r.get('/api/live-streams/:id/ingest', LiveStreamIngestGet);
				r.post('/api/live-streams/:id/start', LiveStreamStart);
				r.patch('/api/live-streams/:id/premiere', PremiereSwap);
				r.put('/api/videos/:id', VideoUpdate);
				r.patch('/api/videos/bulk', VideoBulkUpdate);
				r.post('/api/videos/bulk/undo', VideoBulkUndo);
				r.post('/api/videos/:id/schedule', VideoScheduleCreate);
				r.post('/api/videos/bulk-schedule', VideoBulkSchedule);
				r.post('/api/videos/:id/publish-now', VideoSchedulePublishNow);
				r.post('/api/videos/:id/premiere', VideoPremiereCreate);
				r.post('/api/videos/:videoId/audio-tracks', AudioTrackCreate);
			},
			{ userId: 'owner' },
		);

		const call = async (method: string, path: string, body?: unknown) => {
			const res = await app.request(
				path,
				{
					method,
					headers: { 'Content-Type': 'application/json' },
					...(body !== undefined ? { body: JSON.stringify(body) } : {}),
				},
				env,
			);
			await settle();
			return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
		};

		return { db, call };
	}

	it('refuses unaccepted creators with 403 terms_required on live start, publish, schedule, premiere, and audio tracks; allows non-publishing metadata edit', async () => {
		const { db, call } = await setup();
		const future = new Date(Date.now() + HOUR).toISOString();

		const expectBlocked = (res: { status: number; json: Json }, label: string) => {
			assert.equal(res.status, 403, `${label}: expected 403, got ${res.status} (${JSON.stringify(res.json)})`);
			assert.equal(res.json.code, CREATOR_ERROR_CODES.termsRequired, `${label}: expected terms_required`);
		};

		expectBlocked(await call('GET', '/api/live-streams/s1/ingest'), 'GET /api/live-streams/:id/ingest');
		expectBlocked(await call('POST', '/api/live-streams/s1/start'), 'POST /api/live-streams/:id/start');
		expectBlocked(
			await call('PATCH', '/api/live-streams/p1/premiere', { videoId: 'v-draft' }),
			'PATCH /api/live-streams/:id/premiere',
		);
		expectBlocked(await call('PUT', '/api/videos/v-draft', { visibility: 'public' }), 'PUT /api/videos/:id (draft -> public)');
		expectBlocked(await call('PUT', '/api/videos/v-draft', { visibility: 'unlisted' }), 'PUT /api/videos/:id (draft -> unlisted)');
		expectBlocked(
			await call('PATCH', '/api/videos/bulk', { ids: ['v-draft'], changes: { visibility: 'public' } }),
			'PATCH /api/videos/bulk (visibility: public)',
		);
		expectBlocked(
			await call('POST', '/api/videos/v-draft/schedule', { scheduledPublishDate: future, timezone: 'UTC' }),
			'POST /api/videos/:id/schedule',
		);
		expectBlocked(
			await call('POST', '/api/videos/bulk-schedule', { videoIds: ['v-draft'], startAt: future, timezone: 'UTC' }),
			'POST /api/videos/bulk-schedule',
		);
		expectBlocked(await call('POST', '/api/videos/v-draft/publish-now'), 'POST /api/videos/:id/publish-now');
		expectBlocked(
			await call('POST', '/api/videos/v-draft/premiere', { scheduledStartTime: future }),
			'POST /api/videos/:id/premiere',
		);
		expectBlocked(
			await call('POST', '/api/videos/v-draft/audio-tracks', {
				language: 'ar',
				kind: 'dub',
				source: { type: 'upload', bytes: 1024, fileName: 'dub.m4a' },
			}),
			'POST /api/videos/:videoId/audio-tracks',
		);

		// Editing metadata of an already-public (or legacy isPublic: undefined) video or closing public -> unlisted is NOT blocked
		const editExisting = await call('PUT', '/api/videos/v-public', { title: 'Updated Title' });
		assert.equal(editExisting.status, 200, 'non-publishing metadata edit on existing public video succeeds');
		const editLegacy = await call('PUT', '/api/videos/v-legacy-public', { title: 'Legacy Updated', visibility: 'public' });
		assert.equal(editLegacy.status, 200, 'legacy isPublic: undefined video keeps non-publishing edit allowed');
		const bulkTagsOnly = await call('PATCH', '/api/videos/bulk', { ids: ['v-public'], changes: { addTags: ['reminder'] } });
		assert.equal(bulkTagsOnly.status, 200, 'non-publishing bulk metadata edit succeeds');
		const bulkPublicToUnlisted = await call('PATCH', '/api/videos/bulk', { ids: ['v-public'], changes: { visibility: 'unlisted' } });
		assert.equal(bulkPublicToUnlisted.status, 200, 'bulk public -> unlisted stays allowed without terms');

		// Closing public -> private in bulk is allowed, but undoing that edit (reopening private -> public) requires terms
		const bulkClose = await call('PATCH', '/api/videos/bulk', {
			ids: ['v-legacy-public'],
			operationId: 'be_close_reopen_1',
			changes: { visibility: 'private' },
		});
		assert.equal(bulkClose.status, 200, 'closing public -> private in bulk succeeds');
		expectBlocked(
			await call('POST', '/api/videos/bulk/undo', { operationId: 'be_close_reopen_1', ids: ['v-legacy-public'] }),
			'POST /api/videos/bulk/undo reopening a closed video',
		);

		// Accepting the current Terms version unlocks publishing and scheduling
		await recordCreatorTermsAcceptance(db as unknown as D1Database, 'owner', CURRENT_CREATOR_TERMS_VERSION);
		const scheduleOk = await call('POST', '/api/videos/v-draft/schedule', { scheduledPublishDate: future, timezone: 'UTC' });
		assert.equal(scheduleOk.status, 200, 'schedule succeeds after accepting terms');
		const publishNowOk = await call('POST', '/api/videos/v-draft/publish-now');
		assert.equal(publishNowOk.status, 200, 'publish-now succeeds after accepting terms');
	});
});
