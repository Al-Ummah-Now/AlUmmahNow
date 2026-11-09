/** Studio plan limits, enforced through a stubbed resolver until PR #390 supplies the real one. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENTITLEMENT_CATALOGUE, studioFailureKind, studioVideoStatus } from '@al-ummah/shared-types';
import { checkBulkScheduleAllowed, checkDraftAllowed, type EntitlementResolver } from '../src/lib/studioLimits';
import { VideoSchedulePublishNow } from '../src/endpoints/video/schedulePublishNow';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const resolver = (values: Record<string, unknown>): EntitlementResolver => async () => ({
	entitlements: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) as never,
});
const context = { userId: 'u1', channelId: 'c1' };

describe('studio.drafts.max', () => {
	it('allows below the limit and at unlimited', async () => {
		assert.equal(await checkDraftAllowed({}, { ...context, drafts: 4 }, resolver({ 'studio.drafts.max': 5 })), null);
		assert.equal(await checkDraftAllowed({}, { ...context, drafts: 9999 }, resolver({ 'studio.drafts.max': 'unlimited' })), null);
	});

	it('refuses at the limit with the standard body', async () => {
		const refused = await checkDraftAllowed({}, { ...context, drafts: 5 }, resolver({ 'studio.drafts.max': 5 }));
		assert.equal(refused?.error, 'upgrade_required');
		assert.equal(refused?.entitlement, 'studio.drafts.max');
		assert.equal(refused?.limit, 5);
		assert.equal(refused?.current, 5);
	});

	it('resolves on the channel and the owner', async () => {
		let subjects: unknown;
		await checkDraftAllowed({}, { ...context, drafts: 0 }, async (_env, s) => { subjects = s; return { entitlements: { 'studio.drafts.max': { value: 1 } } as never }; });
		assert.deepEqual(subjects, [{ type: 'channel', id: 'c1' }, { type: 'user', id: 'u1' }]);
	});

	it('allows everything while no resolver exists', async () => {
		assert.equal(await checkDraftAllowed({}, { ...context, drafts: 9999 }, null), null);
	});

	it('allows when the resolver fails: an outage must not lock creators out', async () => {
		assert.equal(await checkDraftAllowed({}, { ...context, drafts: 9999 }, async () => { throw new Error('D1 down'); }), null);
	});
});

describe('studio.bulkSchedule', () => {
	it('allows when on, and refuses when off', async () => {
		assert.equal(await checkBulkScheduleAllowed({}, 'u1', resolver({ 'studio.bulkSchedule': true })), null);
		const refused = await checkBulkScheduleAllowed({}, 'u1', resolver({ 'studio.bulkSchedule': false }));
		assert.equal(refused?.entitlement, 'studio.bulkSchedule');
	});

	it('allows while no resolver exists', async () => {
		assert.equal(await checkBulkScheduleAllowed({}, 'u1', null), null);
	});
});

describe('catalogue', () => {
	it('declares both keys', () => {
		const keys = ENTITLEMENT_CATALOGUE.map((d) => d.key);
		assert.ok(keys.includes('studio.drafts.max') && keys.includes('studio.bulkSchedule'));
	});
});

describe('failure kind', () => {
	it('tells a failed publish from a failed upload', () => {
		assert.equal(studioFailureKind({ scheduledPublishStatus: 'failed' }), 'publish');
		assert.equal(studioFailureKind({ uploadStatus: 'ready', scheduledPublishStatus: 'failed' }), 'publish');
		assert.equal(studioFailureKind({ uploadStatus: 'failed' }), 'upload');
		assert.equal(studioFailureKind({ processingStatus: 'failed' }), 'upload');
		assert.equal(studioFailureKind({ uploadStatus: 'failed', scheduledPublishStatus: 'failed' }), 'upload');
		assert.equal(studioFailureKind({}), null);
	});
});

describe('retrying a failed scheduled publish', () => {
	it('publishes it through publish-now', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: 'owner', isPublic: false, scheduledPublishStatus: 'failed' }) });
		const app = buildApp((r: any) => r.post('/api/videos/:id/publish-now', VideoSchedulePublishNow), { userId: 'owner' });
		const res = await app.request('/api/videos/v1/publish-now', { method: 'POST' }, { videos, queue: new MemoryQueue() } as never);
		assert.equal(res.status, 200, await res.clone().text());
		const stored = JSON.parse(videos.store.get('v1') as string);
		assert.equal(stored.isPublic, true);
		assert.equal(studioVideoStatus(stored), 'published');
	});
});
