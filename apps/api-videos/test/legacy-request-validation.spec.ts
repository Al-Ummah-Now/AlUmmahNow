import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Hono } from 'hono';
import { ListPostComments } from '../src/endpoints/community/post-comments-list';
import { ListPostCommentReplies } from '../src/endpoints/community/post-comment-replies-list';
import { ListWatchHistory } from '../src/endpoints/watch-history/list';
import { buildApp } from './helpers';
import { createCaptionJobsInternalRouter } from '../src/endpoints/captions/captionJobsInternal';
import { createDiscoveryInternalRouter } from '../src/endpoints/discovery/discoveryInternal';
import { createDownloadsInternalRouter } from '../src/endpoints/downloads/downloadsInternal';
import { createNotificationsInternalRouter } from '../src/endpoints/notifications/notificationsInternal';
import { createFootprintsInternalRouter } from '../src/endpoints/privacy/footprintsInternal';
import { createPlaylistAddsInternalRouter } from '../src/endpoints/playlist/playlistAddsInternal';
import { createChannelCommentsInternalRouter } from '../src/endpoints/channel/channelCommentsInternal';
import { createVideoFormatInternalRouter } from '../src/endpoints/video/videoFormatInternal';
import { createAudioTracksInternalRouter } from '../src/endpoints/audio/audioTracksInternal';

import { createReviewInternalRouter } from '../src/endpoints/review/reviewInternal';

import { createProcessingInternalRouter } from '../src/endpoints/video/processingInternal';
import { createUploadsInternalRouter } from '../src/endpoints/video/uploadsInternal';

import { createMediaInternalRouter } from '../src/endpoints/media/mediaInternal';

import { createBackfillInternalRouter } from '../src/endpoints/media/backfillInternal';
import { handleCheckout } from '../src/endpoints/billing/billing';
import { createAccountEventsInternalRouter } from '../src/endpoints/account-events/accountEvents';

import { createYoutubeImportInternalRouter } from '../src/endpoints/youtube-import/youtubeImportInternal';
import { handleCreateTierRequest, handleMyTierRequests, handleWithdrawTierRequest } from '../src/endpoints/creator/tierRequests';

const oversized = 'x'.repeat(129);

const cases = [
	[createYoutubeImportInternalRouter, 'PUT', '/settings', { actorId: ['admin'] }],
	[createYoutubeImportInternalRouter, 'PUT', '/client-secret', { value: ['fixture-secret'] }],
	[createCaptionJobsInternalRouter, 'POST', '/jobs/retry', { jobId: oversized }],
	[createCaptionJobsInternalRouter, 'POST', '/metadata-translations', { videoId: 'v1', lang: 'en', sourceHash: '0'.repeat(64), title: 'Title', provider: 1 }],
	[createCaptionJobsInternalRouter, 'POST', '/jobs/job-1/audio', { ok: true, manifestKey: 7 }],
	[createCaptionJobsInternalRouter, 'POST', '/jobs/job-1/progress', { status: 'transcribing', done: 1.5 }],
	[createCaptionJobsInternalRouter, 'POST', '/jobs/job-1/finish', { outcome: 'failed', error: ['failed'] }],
	[createDiscoveryInternalRouter, 'POST', '/rank', { actorId: oversized }],
	[createDiscoveryInternalRouter, 'GET', '/preview?rail=top&limit=1.5', undefined],
	[createDownloadsInternalRouter, 'PUT', '/rate-limit', { actorId: oversized, perDay: 100, burstPerMinute: 5 }],
	[createNotificationsInternalRouter, 'PUT', '/settings', { actorId: oversized, menuOpen: 'seen' }],
	[createFootprintsInternalRouter, 'POST', '/backfill', { buckets: 'videos' }],
	[createPlaylistAddsInternalRouter, 'POST', '/retry', { videoId: oversized, playlistId: 'list-1' }],
	[createChannelCommentsInternalRouter, 'POST', '/retry', { job: 'rebuild', channelId: oversized }],
	[createVideoFormatInternalRouter, 'POST', '/backfill', { dryRun: 'false' }],
	[createAudioTracksInternalRouter, 'POST', '/v1/package', { jobId: 'job-1', rev: 'r1', access: 'pub', ok: true, master: {}, trackIds: [] }],
	[createAudioTracksInternalRouter, 'POST', '/v1/detected', { jobId: 'job-1', ok: true, streams: {} }],
	[createAudioTracksInternalRouter, 'POST', '/v1/aud-1/prepared', { jobId: 'job-1', ok: true, durationSeconds: '1' }],
	[createReviewInternalRouter, 'POST', '/images/outcome', { subject: 'post', subjectId: 'p1', reviewId: 'r1', result: 'approve', reasonCode: {} }],
	[createReviewInternalRouter, 'POST', '/images/decision', { subject: 'post', subjectId: 'p1', reviewId: 'r1', result: 'reject', reviewerId: {} }],
	[createReviewInternalRouter, 'POST', '/v1/outcome', { reviewId: 'r1', routing: { route: 'approve', risk: '1' } }],
	[createReviewInternalRouter, 'POST', '/v1/decision', { reviewId: 'r1', reviewerId: 'u1', decision: 'approve', decidedAt: {} }],
	[createReviewInternalRouter, 'POST', '/livestream/s1/outcome', { reviewId: 'r1', routing: { route: 'approve', risk: '1' } }],
	[createReviewInternalRouter, 'POST', '/livestream/s1/decision', { reviewId: 'r1', reviewerId: 'u1', decision: 'approve', decidedAt: {} }],
	[createReviewInternalRouter, 'POST', '/livestream/s1/media', { reviewId: 'r1', manifestKey: 'unrelated/path.json' }],
	[createReviewInternalRouter, 'POST', '/audio-track/v1/aud-1/outcome', { reviewId: 'r1', routing: { route: 'approve', risk: '1' } }],
	[createReviewInternalRouter, 'POST', '/audio-track/v1/aud-1/decision', { reviewId: 'r1', reviewerId: 'u1', decision: 'approve', decidedAt: {} }],
	[createProcessingInternalRouter, 'GET', '/videos?status=unknown', undefined],
	[createProcessingInternalRouter, 'GET', '/errors?limit=1.5', undefined],
	[createProcessingInternalRouter, 'GET', '/thumbnails?limit=1.5', undefined],
	[createProcessingInternalRouter, 'POST', '/sync', { ids: ['video-123'], dryRun: 'false' }],
	[createProcessingInternalRouter, 'POST', '/thumbnails', { dryRun: 0 }],
	[createProcessingInternalRouter, 'POST', '/thumbnails/' + oversized + '/retry', undefined],
	[createProcessingInternalRouter, 'POST', '/index-rebuild', { kind: 'video', actorId: {} }],
	[createProcessingInternalRouter, 'POST', '/index-repairs/retry', { entity: 'video' }],
	[createProcessingInternalRouter, 'POST', '/retry', { ids: [35] }],
	[createProcessingInternalRouter, 'POST', '/mark-failed', { ids: ['video-123'], reason: {} }],
	[createUploadsInternalRouter, 'GET', '/stale?limit=11.5', undefined],
	[createUploadsInternalRouter, 'POST', '/stale', { hide: [oversized] }],
	[createUploadsInternalRouter, 'POST', '/scan', { actor: {} }],
	[createUploadsInternalRouter, 'POST', '/delete', { ids: ['video-123'], actor: {} }],
	[createUploadsInternalRouter, 'POST', '/retry', { ids: ['video-123'], actor: {} }],
	[createUploadsInternalRouter, 'POST', '/keep', { ids: ['video-123'], actor: {} }],
	[createUploadsInternalRouter, 'POST', '/mode', { mode: 'live', actor: {} }],
	[createMediaInternalRouter, 'POST', '/events', { videoId: 'video-123', jobId: 'job-12345', type: 'ready', at: '2026-11-28T00:00:00Z', attempt: 1, result: { rungs: {} } }],
	[createMediaInternalRouter, 'POST', '/mp4', { videoId: 'video-123', jobId: 'job-12345', type: 'ready', at: '2026-11-28T00:00:00Z', rev: '0123456789abcdef', access: 'pub', mp4: {} }],
	[createMediaInternalRouter, 'POST', '/retry', { ids: ['video-123', 11] }],
	[createMediaInternalRouter, 'GET', '/hdr-check?live=yes', undefined],
	[createMediaInternalRouter, 'POST', '/hdr-check', { actorId: oversized }],
	[createMediaInternalRouter, 'GET', '/jobs?status=unrecognized', undefined],
	[createMediaInternalRouter, 'GET', '/troubleshoot?video=' + oversized, undefined],
	[createMediaInternalRouter, 'POST', '/troubleshoot/actions', { action: 'cancel', videoId: 'video-123', actorId: oversized }],
	[createMediaInternalRouter, 'POST', '/troubleshoot/retry-now', { videoId: 11 }],
	[createMediaInternalRouter, 'POST', '/troubleshoot/jobs/retry', { jobId: {} }],
	[createMediaInternalRouter, 'GET', '/qoe-live?minutes=1.5', undefined],
	[createMediaInternalRouter, 'GET', '/summary?days=1.5', undefined],
	[createMediaInternalRouter, 'PUT', '/transcode-limit', { actorId: oversized }],
	[createMediaInternalRouter, 'PUT', '/settings', { actorId: 'admin', transcode: 'false' }],
	[createMediaInternalRouter, 'PUT', '/providers', { actorId: 'admin', settings: [] }],
	[createMediaInternalRouter, 'PUT', '/videos/video-123/override', { actorId: oversized, override: null }],
	[createBackfillInternalRouter, 'GET', '/runs?limit=1.5', undefined],
	[createBackfillInternalRouter, 'POST', '/runs', { actorId: oversized }],
	[createBackfillInternalRouter, 'GET', '/runs/run-12345/items?limit=1.5', undefined],
	[createBackfillInternalRouter, 'PUT', '/runs/run-12345/settings', { settings: [] }],
	[createBackfillInternalRouter, 'POST', '/items/retry', { runId: 1 }],
	[createBackfillInternalRouter, 'POST', '/flip', { target: 'global', undo: 'false' }],
	[createBackfillInternalRouter, 'GET', '/libraries/1/removals?limit=1.5', undefined],
	[createBackfillInternalRouter, 'POST', '/libraries/1/removals', { graceDays: [] }],
	[createBackfillInternalRouter, 'POST', '/removals/retry', { videoId: 1 }],
] as const;

for (const [createRouter, method, path, body] of cases) {
	it(createRouter.name + ' rejects invalid input for ' + method + ' ' + path, async () => {
		const app = createRouter() as Hono;
		const env = new Proxy({}, { get: () => assert.fail('invalid input reached a service binding') });
		const response = await app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } }, env);
		assert.equal(response.status, 400);
	});
}

it('refuses a mistyped purge option on a test library', async () => {
	const app = createUploadsInternalRouter();
	const response = await app.request('/test-library-purge', {
		method: 'POST', body: JSON.stringify({ action: 'start', dryRun: 'false' }), headers: { 'content-type': 'application/json' },
	}, { BUNNY_TEST_LIBRARY: 'true', ENVIRONMENT: 'qa' } as never);
	assert.equal(response.status, 400);
});

it('validates billing checkout before the contact lookup', async () => {
	const app = new Hono();
	app.post('/checkout', (c) => {
		c.set('userId' as never, 'usr_member' as never);
		return handleCheckout(c);
	});
	const env = new Proxy({}, { get: () => assert.fail('invalid input reached a service binding') });
	const response = await app.request('/checkout', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tierId: 'creator', provider: ['paygood'], period: 'month', currency: 'USD' }),
	}, env);
	assert.equal(response.status, 400);
});

it('drops a malformed account event retry without consulting storage', async () => {
	const app = createAccountEventsInternalRouter();
	const env = new Proxy({}, { get: () => assert.fail('invalid input reached a service binding') });
	const response = await app.request('/retry', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jti: 'x'.repeat(129) }),
	}, env as never);
	assert.equal(response.status, 404);
});

for (const [handler, method, path, body] of [
	[handleCreateTierRequest, 'POST', '/requests', []],
	[handleMyTierRequests, 'GET', '/requests?cursor=invalid', undefined],
	[handleWithdrawTierRequest, 'POST', '/requests/invalid/withdraw', undefined],
] as const) {
	it(handler.name + ' rejects malformed input before storage', async () => {
		const app = new Hono();
		app.on(method, '/requests/:id/withdraw', (c) => { c.set('userId' as never, 'usr_member' as never); return handler(c); });
		app.on(method, '/requests', (c) => { c.set('userId' as never, 'usr_member' as never); return handler(c); });
		const env = new Proxy({}, { get: () => assert.fail('invalid input reached a service binding') });
		const response = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
		assert.equal(response.status, 400);
	});
}

for (const [route, mount, path] of [
	[ListPostComments, '/posts/:channelId/:postId/comments', '/posts/ch1/post1/comments?sortBy=unknown'],
	[ListPostCommentReplies, '/posts/:channelId/:postId/:commentId/replies', '/posts/ch1/post1/comment1/replies?limit=1.5'],
	[ListWatchHistory, '/watch-history', '/watch-history?completed=unknown'],
] as const) {
	it(route.name + ' uses its validated query', async () => {
		const app = buildApp((router) => router.get(mount, route), { userId: 'usr_member' });
		const res = await app.request(path, {}, {});
		assert.equal(res.status, 400);
	});
}
