/**
 * Channel @handle claims are atomic (docs/architecture/SCALABILITY-AUDIT.md, AV-13).
 *
 * The index entry `channel-handles/<handle>` is created with a create-only
 * conditional put (R2 evaluates it atomically), so of any number of channels
 * claiming the same handle at once exactly one gets it. The old put +
 * read-back let two claims both succeed when each read back before the
 * other's put.
 *
 * Runs against an R2 fake that honours `onlyIf` and widens the read → write
 * window (SlowBucket), through the library and the channel update endpoint.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { claimHandle, releaseHandle } from '../src/lib/channelHandles';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';

describe('handle claims (AV-13)', () => {
	it('50 channels claiming the same handle at once: exactly one wins', async () => {
		const bucket = new SlowBucket({});
		const results = await Promise.all(Array.from({ length: 50 }, (_, i) => claimHandle(bucket as any, 'Quran', { id: `c${i}`, userId: `u${i}` })));
		const winners = results.map((r, i) => (r.ok ? `c${i}` : null)).filter(Boolean);
		assert.equal(winners.length, 1);
		assert.equal(bucket.read('channel-handles/quran').channelId, winners[0]);
		assert.ok(results.every((r) => r.ok || r.reason === 'taken'));
	});

	it('a channel re-claiming its own handle succeeds and can change its letter case', async () => {
		const bucket = new SlowBucket({});
		assert.deepEqual(await claimHandle(bucket as any, 'noor', { id: 'c1', userId: 'u1' }), { ok: true, handle: 'noor' });
		const again = await Promise.all([1, 2, 3].map(() => claimHandle(bucket as any, 'Noor', { id: 'c1', userId: 'u1' })));
		assert.ok(again.every((r) => r.ok));
		assert.equal(bucket.read('channel-handles/noor').handle, 'Noor');
		assert.deepEqual(await claimHandle(bucket as any, 'NOOR', { id: 'c2', userId: 'u2' }), { ok: false, reason: 'taken' });
	});

	it('release and a new claim race: the handle never ends up with two owners', async () => {
		for (let round = 0; round < 10; round++) {
			const bucket = new SlowBucket({});
			await claimHandle(bucket as any, 'shared', { id: 'old', userId: 'u0' });
			const [, ...claims] = await Promise.all([
				releaseHandle(bucket as any, 'shared', 'old'),
				...Array.from({ length: 5 }, (_, i) => claimHandle(bucket as any, 'shared', { id: `n${i}`, userId: `u${i + 1}` })),
			]);
			const winners = claims.map((r, i) => (r.ok ? `n${i}` : null)).filter(Boolean);
			assert.ok(winners.length <= 1, `at most one new owner, got ${winners}`);
			const entry = bucket.read('channel-handles/shared');
			if (winners.length === 1) assert.equal(entry?.channelId, winners[0]);
		}
	});

	it('20 owners setting the same handle on their channels at once: one channel has it', async () => {
		const channels: Record<string, unknown> = {};
		for (let i = 0; i < 20; i++) channels[`c${i}`] = { id: `c${i}`, userId: `u${i}`, name: `Channel ${i}`, isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' };
		const e = { channels: new MemoryBucket(channels), channel_tabs: new SlowBucket({}), queue: new MemoryQueue() };
		const statuses = await Promise.all(Array.from({ length: 20 }, (_, i) =>
			buildApp((r: any) => r.put('/api/channels/:id', ChannelUpdate), { userId: `u${i}` })
				.request(`/api/channels/c${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: 'quran' }) }, e)
				.then((r) => r.status)));
		assert.equal(statuses.filter((s) => s === 200).length, 1, statuses.join());
		assert.equal(statuses.filter((s) => s === 409).length, 19);
		const holders = Array.from({ length: 20 }, (_, i) => e.channels.read(`c${i}`)).filter((ch: any) => ch.handle === 'quran');
		assert.equal(holders.length, 1);
		assert.equal(e.channel_tabs.read('channel-handles/quran').channelId, holders[0].id);
	});

	it('one channel changing its handle 10 ways at once: it keeps one, no claim is left over', async () => {
		for (let round = 0; round < 5; round++) {
			const e = {
				channels: new SlowBucket({ c1: { id: 'c1', userId: 'u1', name: 'Channel', handle: 'start', isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' } }),
				channel_tabs: new SlowBucket({ 'channel-handles/start': { handle: 'start', channelId: 'c1', userId: 'u1' } }),
				queue: new MemoryQueue(),
			};
			const app = buildApp((r: any) => r.put('/api/channels/:id', ChannelUpdate), { userId: 'u1' });
			const statuses = await Promise.all(Array.from({ length: 10 }, (_, i) =>
				app.request('/api/channels/c1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: `name${i}` }) }, e).then((r) => r.status)));
			assert.ok(statuses.every((s) => s === 200), statuses.join());
			const final = e.channels.read('c1').handle;
			const claims = [...e.channel_tabs.store.keys()].filter((k) => k.startsWith('channel-handles/'));
			assert.deepEqual(claims, [`channel-handles/${final}`], `only the handle in use is claimed (${final})`);
		}
	});

	it('a name edit racing a handle change does not revert the handle', async () => {
		for (let round = 0; round < 10; round++) {
			const e = {
				channels: new SlowBucket({ c1: { id: 'c1', userId: 'u1', name: 'Old', handle: 'old', isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' } }),
				channel_tabs: new SlowBucket({ 'channel-handles/old': { handle: 'old', channelId: 'c1', userId: 'u1' } }),
				queue: new MemoryQueue(),
			};
			const app = buildApp((r: any) => r.put('/api/channels/:id', ChannelUpdate), { userId: 'u1' });
			const put = (body: unknown) => app.request('/api/channels/c1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, e);
			await Promise.all([put({ handle: 'fresh' }), put({ name: 'New name' })]);
			const channel = e.channels.read('c1');
			assert.equal(channel.handle, 'fresh');
			assert.equal(channel.name, 'New name');
			assert.equal(e.channel_tabs.read('channel-handles/fresh')?.channelId, 'c1');
			assert.ok(!e.channel_tabs.read('channel-handles/old'), 'the old handle is free');
		}
	});

	it('erasure frees only handles that are the channel\'s own', async () => {
		const empty = () => new MemoryBucket({});
		const env = {
			profiles: new MemoryBucket({ me: { id: 'me', email: 'me@test.local' } }),
			channels: new MemoryBucket({ mine: { id: 'mine', userId: 'me', name: 'Mine', handle: 'stale' } }),
			channel_tabs: new MemoryBucket({
				'channel-handles/stale': { handle: 'stale', channelId: 'someone-else', userId: 'other' },
			}),
			channel_sections: empty(), videos: empty(), watch_history: empty(), community_posts: empty(), playlists: empty(),
			'upload-defaults': empty(), reports: empty(), subtitles: empty(),
		};
		await eraseUserData(env as any, 'me', new OperationBudget(1000));
		assert.equal(env.channel_tabs.read('channel-handles/stale')?.channelId, 'someone-else', 'another channel\'s handle stays');
	});
});
