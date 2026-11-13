/**
 * GET /api/community/posts/:postId (short links, wiki AUN-SHORT-LINKS): a published post's channel
 * by its id alone; drafts, scheduled, hidden and deleted posts, posts of a deleted channel and posts
 * the search index does not know are 404, with nothing about the post in the answer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocateCommunityPost } from '../src/endpoints/community/locate-post';
import { MemoryBucket, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = '2026-11-13T00:00:00.000Z';
const base = { channelId: 'ch', userId: 'u', status: 'published', visibility: 'public', type: 'text', content: 'Secret draft words', createdAt: NOW, updatedAt: NOW };

function env() {
	const search = new SqliteD1();
	const put = search.db.prepare("INSERT INTO search_posts (id, channel_id, payload) VALUES (?, ?, '{}')");
	for (const [id, ch] of [['p1', 'ch'], ['draft', 'ch'], ['sched', 'ch'], ['hidden', 'ch'], ['gone', 'ch'], ['delflag', 'ch'], ['orphan', 'ch'], ['dc', 'dead']]) put.run(id, ch);
	return {
		SEARCH_DB: search,
		community_posts: new MemoryBucket({
			'posts/ch/p1.json': { ...base, id: 'p1' },
			'posts/ch/draft.json': { ...base, id: 'draft', status: 'draft' },
			'posts/ch/sched.json': { ...base, id: 'sched', status: 'scheduled' },
			'posts/ch/hidden.json': { ...base, id: 'hidden', isHidden: true },
			'posts/ch/gone.json': { ...base, id: 'gone', status: 'deleted' },
			'posts/ch/delflag.json': { ...base, id: 'delflag', isDeleted: true },
			'posts/dead/dc.json': { ...base, id: 'dc', channelId: 'dead' },
			'posts/ch/unindexed.json': { ...base, id: 'unindexed' },
		}),
		channels: new MemoryBucket({ ch: { id: 'ch', name: 'C' }, dead: { id: 'dead', isDeleted: true } }),
	};
}

const app = buildApp((r) => r.get('/api/community/posts/:postId', LocateCommunityPost), null);

describe('LocateCommunityPost', () => {
	it('answers a published post with its channel only', async () => {
		const res = await app.request('/api/community/posts/p1', {}, env());
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { id: 'p1', channelId: 'ch' });
	});

	for (const id of ['draft', 'sched', 'hidden', 'gone', 'delflag', 'orphan', 'dc', 'unindexed', 'bad.id']) {
		it(`${id} → 404 without the post`, async () => {
			const res = await app.request(`/api/community/posts/${id}`, {}, env());
			assert.equal(res.status, 404);
			assert.doesNotMatch(await res.text(), /Secret|channel/);
		});
	}
});
