/**
 * Regression tests for #468: channel subscribersCount must count channel.subscriptions
 * (and live D1 counts when NOTIFICATIONS_DB is bound), never the unpopulated channel.subscribers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelFetch } from '../src/endpoints/channel/channelFetch';
import { ChannelsList } from '../src/endpoints/channel/channelList';
import { ChannelByHandleFetch, ChannelAbout } from '../src/endpoints/channel/channelHandle';
import { ChannelOwnerFetch } from '../src/endpoints/channel/channelOwnerFetch';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { SubscriptionCreate } from '../src/endpoints/channel/SubscriptionCreate';
import { SubscriptionsList } from '../src/endpoints/channel/SubscriptionsList';
import { toPublicChannel } from '../src/lib/public-views';
import { transformChannelToView, transformChannelsToView } from '../src/lib/transformations';
import { buildChannelAbout } from '../src/lib/channelAbout';
import { handleKey } from '../src/lib/channelHandles';
import { projectChannel } from '@al-ummah/shared-types';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

function channelFixture(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		userId: `owner-${id}`,
		email: 'owner@test.local',
		name: `Channel ${id}`,
		handle: `handle${id}`,
		isMain: true,
		dateCreated: '2026-01-01T00:00:00.000Z',
		dateModified: '2026-01-01T00:00:00.000Z',
		playlists: [],
		videos: [],
		subscribers: [],
		subscriptions: [],
		likes: [],
		...overrides,
	};
}

function routes(r: any) {
	r.get('/api/channels', ChannelsList);
	r.get('/api/channels/:id', ChannelFetch);
	r.get('/api/channels/by-handle/:handle', ChannelByHandleFetch);
	r.get('/api/channels/:id/about', ChannelAbout);
	r.get('/api/channels/:id/owner', ChannelOwnerFetch);
	r.put('/api/channels/:id', ChannelUpdate);
	r.post('/api/channels/:id/subscriptions', SubscriptionCreate);
	r.get('/api/profile/subscriptions', SubscriptionsList);
}

describe('channel subscribersCount (#468)', () => {
	it('pure view helpers count distinct channel.subscriptions when channel.subscribers is empty', () => {
		const ch = channelFixture('c1', {
			subscribers: [],
			subscriptions: [
				{ id: 's1', userId: 'u1', channelId: 'fan-1', dateCreated: '2026-01-02T00:00:00.000Z' },
				{ id: 's2', userId: 'u2', channelId: 'fan-2', dateCreated: '2026-01-03T00:00:00.000Z' },
				// Duplicate subscriber channel should be deduplicated
				{ id: 's3', userId: 'u1', channelId: 'fan-1', dateCreated: '2026-01-04T00:00:00.000Z' },
			],
		});

		assert.equal(toPublicChannel(ch as never).subscribersCount, 2);
		assert.equal(toPublicChannel(ch as never, 9).subscribersCount, 9);
		assert.equal(transformChannelToView(ch as never).subscribersCount, 2);
		assert.equal(transformChannelToView(ch as never, 9).subscribersCount, 9);
		assert.equal(buildChannelAbout(ch as never, { totalViews: 0, videosCount: 0, partial: false }).subscribersCount, 2);
		assert.equal(buildChannelAbout(ch as never, { totalViews: 0, videosCount: 0, partial: false }, 9).subscribersCount, 9);
		assert.equal(projectChannel(ch)?.payload.subscribersCount, 2);
	});

	it('preserves each channel’s subscriber count in a batch of channel views', () => {
		const ch0 = channelFixture('ch0', { subscriptions: [{ channelId: 'fan-1' }, { channelId: 'fan-2' }] });
		const ch1 = channelFixture('ch1');
		const ch2 = channelFixture('ch2', { subscriptions: [{ channelId: 'fan-1' }, { channelId: 'fan-2' }, { channelId: 'fan-3' }] });

		const views = transformChannelsToView([ch0, ch1, ch2] as never);

		assert.deepEqual(views.map((view) => view.subscribersCount), [2, 0, 3]);
		assert.deepEqual(views.map((view) => view.subscriptionsCount), [2, 0, 3]);
	});

	it('channel endpoints report subscribersCount from legacy channel.subscriptions without D1', async () => {
		const ch = channelFixture('c1', {
			userId: 'owner',
			subscribers: [],
			subscriptions: [
				{ id: 's1', userId: 'u1', channelId: 'fan-1', dateCreated: '2026-01-02T00:00:00.000Z' },
				{ id: 's2', userId: 'u2', channelId: 'fan-2', dateCreated: '2026-01-03T00:00:00.000Z' },
			],
		});
		const env = {
			channels: new MemoryBucket({ c1: ch }),
			profiles: new MemoryBucket({ u1: { id: 'u1', subscribedTo: ['c1'] } }),
			videos: new MemoryBucket(),
			channel_tabs: new MemoryBucket({ [handleKey('handlec1')]: { handle: 'handlec1', channelId: 'c1', userId: 'owner' } }),
			queue: new MemoryQueue(),
		};
		const anon = buildApp(routes, null);
		const owner = buildApp(routes, { userId: 'owner' });

		const list = await (await anon.request('/api/channels?scope=all&limit=10', {}, env)).json() as any;
		assert.equal(list.data[0].subscribersCount, 2);

		const fetched = await (await anon.request('/api/channels/c1', {}, env)).json() as any;
		assert.equal(fetched.subscribersCount, 2);

		const byHandle = await (await anon.request('/api/channels/by-handle/handlec1', {}, env)).json() as any;
		assert.equal(byHandle.subscribersCount, 2);

		const about = await (await anon.request('/api/channels/c1/about', {}, env)).json() as any;
		assert.equal(about.result.subscribersCount, 2);

		const ownerView = await (await owner.request('/api/channels/c1/owner', {}, env)).json() as any;
		assert.equal(ownerView.subscribersCount, 2);

		const updated = await (await owner.request('/api/channels/c1', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Renamed' }),
		}, env)).json() as any;
		assert.equal(updated.result.channel.subscribersCount, 2);
	});

	it('channel endpoints report live D1 subscribersCount after SubscriptionCreate', async () => {
		const env = {
			channels: new MemoryBucket({
				target: channelFixture('target', { userId: 'owner' }),
				'fan1-ch': channelFixture('fan1-ch', { userId: 'fan1' }),
				'fan2-ch': channelFixture('fan2-ch', { userId: 'fan2' }),
			}),
			profiles: new MemoryBucket({ fan1: { id: 'fan1', subscribedTo: [] } }),
			videos: new MemoryBucket(),
			channel_tabs: new MemoryBucket({ [handleKey('handletarget')]: { handle: 'handletarget', channelId: 'target', userId: 'owner' } }),
			queue: new MemoryQueue(),
			NOTIFICATIONS_DB: createSqliteD1(),
		};

		const sub1 = await buildApp(routes, { userId: 'fan1' }).request('/api/channels/target/subscriptions', { method: 'POST', headers: { channelId: 'fan1-ch' } }, env);
		assert.equal(sub1.status, 201);
		const sub2 = await buildApp(routes, { userId: 'fan2' }).request('/api/channels/target/subscriptions', { method: 'POST', headers: { channelId: 'fan2-ch' } }, env);
		assert.equal(sub2.status, 201);

		const anon = buildApp(routes, null);
		const owner = buildApp(routes, { userId: 'owner' });

		const list = await (await anon.request('/api/channels?scope=all&limit=10', {}, env)).json() as any;
		const targetInList = list.data.find((c: any) => c.id === 'target');
		assert.equal(targetInList.subscribersCount, 2);

		const fetched = await (await anon.request('/api/channels/target', {}, env)).json() as any;
		assert.equal(fetched.subscribersCount, 2);

		const byHandle = await (await anon.request('/api/channels/by-handle/handletarget', {}, env)).json() as any;
		assert.equal(byHandle.subscribersCount, 2);

		const about = await (await anon.request('/api/channels/target/about', {}, env)).json() as any;
		assert.equal(about.result.subscribersCount, 2);

		const ownerView = await (await owner.request('/api/channels/target/owner', {}, env)).json() as any;
		assert.equal(ownerView.subscribersCount, 2);

		const updated = await (await owner.request('/api/channels/target', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ description: 'Updated bio' }),
		}, env)).json() as any;
		assert.equal(updated.result.channel.subscribersCount, 2);

		const subsList = await (await buildApp(routes, { userId: 'fan1' }).request('/api/profile/subscriptions', {}, env)).json() as any;
		assert.equal(subsList.data[0].subscribersCount, 2);
	});
});
