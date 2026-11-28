import assert from 'node:assert/strict';
import { it } from 'node:test';

it('rejects a malformed translation response from the processor binding', async () => {
	const { callProcessor } = await import('../src/lib/translate/inline');
	const env = {
		PROCESSOR: { fetch: async () => Response.json({ items: [{ id: 'title', text: ['one', 'two'] }], provider: 'workers-ai', model: 'fixture', usd: 0 }) },
	};
	await assert.rejects(callProcessor(env, {
		items: [{ id: 'title', text: 'A title' }], from: 'en', to: 'ar', field: 'title', provider: 'workers-ai', dailyBudgetUsd: 0,
	}), /translation_failed/);
});

it('drops YouTube jobs without their required fields before a database lookup', async () => {
	const { handleYtImportBatch } = await import('../src/lib/youtube-import/jobs');
	let acknowledged = 0;
	const job = (body: unknown) => ({ body, attempts: 1, ack: () => { acknowledged++; }, retry: () => assert.fail('invalid job must not retry') });
	const messages = [job({ kind: 'yt-finalize', importId: 'import-1' }), job({ kind: 'yt-list', importId: 'import-1', phase: 'unknown' })];
	const env = { get SEARCH_DB() { return assert.fail('invalid job must not query D1'); } };
	await handleYtImportBatch({ messages }, env as never, undefined);
	assert.equal(acknowledged, messages.length);
});

it('validates the fields used by processing queue dispatch', async () => {
	const { isBackfillMessage, BACKFILL_KIND } = await import('../src/lib/media/backfill/types');
	const { isMediaMoveMessage, MEDIA_MOVE_KIND } = await import('../src/lib/media/r2-delivery');
	const { isPlaylistAddMessage, PLAYLIST_ADD_KIND } = await import('../src/lib/playlistUploadAdds');
	const { isReaperMessage, REAPER_KIND } = await import('../src/lib/uploads/reaper');
	const { isPurgeMessage, PURGE_KIND } = await import('../src/lib/uploads/testLibraryPurge');
	const { isBunnyDeleteMessage, BUNNY_DELETE_KIND } = await import('../src/lib/uploads/bunnyDelete');
	const { isCollectionBackfillMessage, COLLECTION_BACKFILL_KIND } = await import('../src/lib/bunny/collectionBackfill');
	const { isArchivePrivacyMessage, ARCHIVE_PRIVACY_REWRITE_KIND } = await import('../src/lib/archivePrivacyRewrite');
	const { isFootprintBackfillMessage, FOOTPRINT_BACKFILL_KIND } = await import('../src/lib/privacy/footprints');
	const { isPublishedAtBackfillMessage, PUBLISHED_AT_BACKFILL_KIND } = await import('../src/lib/publishedAtBackfill');
	const { isMp4BackfillMessage, MP4_BACKFILL_KIND } = await import('../src/lib/media/mp4-backfill');
	const { isHdrCheckMessage, HDR_CHECK_KIND } = await import('../src/lib/media/hdr-check');
	const { isChannelCommentsMessage, CHANNEL_COMMENTS_KIND } = await import('../src/lib/channelComments/jobs');
	const runId = 'test-run';
	const videoId = 'test-video';
	const page = { runId, page: 1, cursor: null, dryRun: true };
	const startedAt = '2026-11-28T00:00:00Z';

	const cases = [
		[isBackfillMessage, { kind: BACKFILL_KIND, op: 'copy', runId, videoId }, { offset: '100' }],
		[isMediaMoveMessage, { kind: MEDIA_MOVE_KIND, videoId, moveId: runId, to: 'pub' }, { moveId: '' }],
		[isPlaylistAddMessage, { kind: PLAYLIST_ADD_KIND, videoId, playlistId: 'some-list', loopId: runId }, { loopId: [] }],
		[isReaperMessage, { kind: REAPER_KIND, videoId, target: 'orphan', loopId: runId, check: 0, startedAt }, { target: 'pending' }],
		[isPurgeMessage, { kind: PURGE_KIND, runId, page: 1 }, { page: 0 }],
		[isBunnyDeleteMessage, { kind: BUNNY_DELETE_KIND, videoId, reason: 'owner-delete', at: startedAt }, { reason: 17 }],
		[isCollectionBackfillMessage, { kind: COLLECTION_BACKFILL_KIND, ...page }, { phase: 'other' }],
		[isArchivePrivacyMessage, { kind: ARCHIVE_PRIVACY_REWRITE_KIND, runId, cursor: null, lane: 0, prefixIndex: 0 }, { start: { dryRun: 'yes' } }],
		[isFootprintBackfillMessage, { kind: FOOTPRINT_BACKFILL_KIND, ...page, bucket: 'videos' }, { runId: '' }],
		[isPublishedAtBackfillMessage, { kind: PUBLISHED_AT_BACKFILL_KIND, ...page }, { dryRun: 'yes' }],
		[isMp4BackfillMessage, { kind: MP4_BACKFILL_KIND, ...page }, { limit: '100' }],
		[isHdrCheckMessage, { kind: HDR_CHECK_KIND, runId, page: 1, cursor: null }, { cursor: 100 }],
		[isChannelCommentsMessage, { kind: CHANNEL_COMMENTS_KIND, job: 'rebuild', channelId: 'test-channel', phase: 'videos' }, { phase: 'wrong' }],
	] as const;

	for (const [guard, body, changes] of cases) {
		assert.equal(guard(body), true, body.kind);
		assert.equal(guard({ ...body, ...changes }), false, body.kind);
	}
});
