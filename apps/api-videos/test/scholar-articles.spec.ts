/**
 * Scholar articles on the Community tab (lib/scholar-articles.ts, routers/scholars-internal.router.ts):
 * the CMS posts a scholar's article to their own channel, re-publishing updates the same post, a
 * channel change moves it, hide/show flip it, and nobody can post to someone else's channel.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket } from './helpers';
import { ArticleError, convertScholarPost, hideArticle, parseArticle, parseConvert, scholarPostMapping, upsertArticle } from '../src/lib/scholar-articles';
import app from '../src/routers/scholars-internal.router';

function env() {
	const channels = new MemoryBucket();
	const community_posts = new MemoryBucket();
	return { channels: channels as unknown as R2Bucket, community_posts: community_posts as unknown as R2Bucket };
}

async function channel(e: ReturnType<typeof env>, id: string, userId: string, extra: Record<string, unknown> = {}) {
	await e.channels.put(id, JSON.stringify({ id, userId, name: `Channel ${id}`, avatarUrl: 'https://img.test/a.jpg', ...extra }));
}

const article = (channelId: string, extra: Record<string, unknown> = {}) =>
	parseArticle({ channelId, title: 'On patience', excerpt: 'A short read', coverUrl: 'https://cms.test/c.jpg', url: 'https://www.test/en/articles/patience/', locale: 'en', publishedAt: '2026-11-10T10:00:00Z', ...extra });

const index = async (e: ReturnType<typeof env>, ch: string) => ((await (await e.community_posts.get(`posts/${ch}/index.json`))?.json()) as { postIds: string[] } | undefined)?.postIds ?? [];
const postOf = async (e: ReturnType<typeof env>, ch: string, id: string) => (await (await e.community_posts.get(`posts/${ch}/${id}.json`))!.json()) as Record<string, any>;

describe('scholar articles', () => {
	it('parseArticle accepts the CMS body and refuses anything else', () => {
		assert.equal(article('c1').title, 'On patience');
		for (const bad of [{ url: 'http://x.test/' }, { coverUrl: 'javascript:alert(1)' }, { locale: 'fr' }, { channelId: '../x' }, { title: ' ' }]) {
			assert.throws(() => article('c1', bad), (e) => e instanceof ArticleError && e.code === 'bad_request');
		}
	});

	it('posts once, updates on re-publish, moves with the channel, hides and shows again', async () => {
		const e = env();
		await channel(e, 'c1', 'u1');
		await channel(e, 'c2', 'u1');
		const first = await upsertArticle(e, 'u1', 'cms-7', article('c1'));
		assert.equal(first.created, true);
		assert.equal(first.post.type, 'article');
		assert.deepEqual((await postOf(e, 'c1', first.post.id)).article.url, 'https://www.test/en/articles/patience/');
		assert.deepEqual(await index(e, 'c1'), [first.post.id]);

		const again = await upsertArticle(e, 'u1', 'cms-7', article('c1', { title: 'On patience (2)' }));
		assert.equal(again.created, false);
		assert.equal(again.post.id, first.post.id);
		assert.equal((await postOf(e, 'c1', first.post.id)).article.title, 'On patience (2)');

		assert.ok(await hideArticle(e, 'u1', 'cms-7'));
		assert.equal((await postOf(e, 'c1', first.post.id)).status, 'deleted');
		assert.deepEqual(await index(e, 'c1'), []);
		const back = await upsertArticle(e, 'u1', 'cms-7', article('c1'));
		assert.equal(back.post.id, first.post.id);
		assert.equal((await postOf(e, 'c1', first.post.id)).status, 'published');
		assert.deepEqual(await index(e, 'c1'), [first.post.id]);

		const moved = await upsertArticle(e, 'u1', 'cms-7', article('c2'));
		assert.equal(moved.created, true);
		assert.deepEqual(await index(e, 'c1'), []);
		assert.deepEqual(await index(e, 'c2'), [moved.post.id]);
		assert.equal(await hideArticle(e, 'u1', 'cms-404'), null);
	});

	it("refuses someone else's channel, a suspended one, and someone else's article", async () => {
		const e = env();
		await channel(e, 'mine', 'u1');
		await channel(e, 'theirs', 'u2');
		await channel(e, 'sus', 'u1', { isSuspended: true });
		await assert.rejects(upsertArticle(e, 'u1', 'cms-1', article('theirs')), (x) => x instanceof ArticleError && x.code === 'not_owner');
		await assert.rejects(upsertArticle(e, 'u1', 'cms-1', article('sus')), (x) => x instanceof ArticleError && x.code === 'channel_suspended');
		await assert.rejects(upsertArticle(e, 'u1', 'cms-1', article('nope')), (x) => x instanceof ArticleError && x.code === 'channel_not_found');
		await upsertArticle(e, 'u1', 'cms-2', article('mine'));
		await assert.rejects(hideArticle(e, 'u2', 'cms-2'), (x) => x instanceof ArticleError && x.code === 'not_owner');
		await assert.rejects(upsertArticle(e, 'u1', 'bad-key', article('mine')), (x) => x instanceof ArticleError);
	});

	it('after the channel moves, what is posted there is its new owner’s: update, hide, convert and read (#1955)', async () => {
		const convert = (channelId: string) =>
			parseConvert({ channelId, kind: 'article', locale: 'en', title: 'On patience', article: { title: 'On patience', body: '<p>Be patient.</p>', excerpt: 'A read' }, www: { url: 'https://www.test/en/articles/patience/', slug: 'patience', locale: 'en' }, status: 'published', publishedAt: null });
		const refused = (p: Promise<unknown>, code = 'not_owner') => assert.rejects(p, (x) => x instanceof ArticleError && x.code === code);
		const e = env();
		await channel(e, 'c1', 'u1');
		await channel(e, 'c2', 'u2');
		const posted = await upsertArticle(e, 'u1', 'cms-7', article('c1'));
		// Before: u1's
		await refused(upsertArticle(e, 'u2', 'cms-7', article('c2')));
		await refused(hideArticle(e, 'u2', 'cms-7'));
		await refused(convertScholarPost(e, 'u2', 'cms-7', convert('c2')));
		assert.equal(await scholarPostMapping(e, 'u2', 'cms-7'), null);
		assert.equal((await scholarPostMapping(e, 'u1', 'cms-7'))!.postId, posted.post.id);

		// The channel moves to u2; u1 has another channel. The mapping still says u1 posted it
		await channel(e, 'c1', 'u2');
		await channel(e, 'c3', 'u1');
		for (const target of ['c1', 'c3']) {
			await refused(upsertArticle(e, 'u1', 'cms-7', article(target)));
			await refused(convertScholarPost(e, 'u1', 'cms-7', convert(target)));
		}
		await refused(hideArticle(e, 'u1', 'cms-7'));
		assert.equal(await scholarPostMapping(e, 'u1', 'cms-7'), null);
		assert.deepEqual(await index(e, 'c1'), [posted.post.id], 'the refusals changed nothing');
		assert.equal((await postOf(e, 'c1', posted.post.id)).status, 'published');

		const updated = await upsertArticle(e, 'u2', 'cms-7', article('c1', { title: 'On patience (2)' }));
		assert.deepEqual([updated.created, updated.post.id], [false, posted.post.id], 'the same post');
		assert.ok(await hideArticle(e, 'u2', 'cms-7'));
		assert.deepEqual(await index(e, 'c1'), []);
		const converted = await convertScholarPost(e, 'u2', 'cms-7', convert('c1'));
		assert.deepEqual([converted.upgraded, converted.post.id], [true, posted.post.id]);
		const mapping = await scholarPostMapping(e, 'u2', 'cms-7');
		assert.deepEqual([mapping!.postId, mapping!.userId], [posted.post.id, 'u1'], 'who posted it stays, for the record');
		// Its new owner may move it to another channel of theirs
		const again = await upsertArticle(e, 'u2', 'cms-7', article('c2'));
		assert.equal(again.created, true);
		assert.deepEqual([await index(e, 'c1'), await index(e, 'c2')], [[], [again.post.id]]);
	});

	it('a channel that is gone leaves the article to who posted it; one that can’t be read answers an error, never a yes', async () => {
		const e = env();
		await channel(e, 'c1', 'u1');
		await channel(e, 'c2', 'u1');
		await upsertArticle(e, 'u1', 'cms-8', article('c1'));
		await e.channels.put('c1', 'not json');
		await assert.rejects(hideArticle(e, 'u1', 'cms-8'), (x) => !(x instanceof ArticleError));
		await assert.rejects(upsertArticle(e, 'u1', 'cms-8', article('c2')), (x) => !(x instanceof ArticleError));
		await e.channels.delete('c1');
		await assert.rejects(hideArticle(e, 'u2', 'cms-8'), (x) => x instanceof ArticleError && x.code === 'not_owner');
		assert.equal((await upsertArticle(e, 'u1', 'cms-8', article('c2'))).created, true);
	});

	it('the internal router reads a post for the channel’s owner of now', async () => {
		const e = env();
		await channel(e, 'c1', 'u1');
		await upsertArticle(e, 'u1', 'cms-9', article('c1'));
		const read = async (userId: string) => (await app.request(`/${userId}/posts/cms-9`, {}, e)).status;
		assert.deepEqual([await read('u1'), await read('u2')], [200, 404]);
		await channel(e, 'c1', 'u2');
		assert.deepEqual([await read('u1'), await read('u2')], [404, 200]);
	});

	it('the internal router answers with codes, never raw errors', async () => {
		const e = env();
		await channel(e, 'c1', 'u1');
		const put = await app.request('/u1/articles/cms-9', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channelId: 'c1', title: 'T', url: 'https://www.test/en/articles/t/', locale: 'ar' }) }, e);
		assert.equal(put.status, 201);
		const body = (await put.json()) as { postId: string; created: boolean };
		assert.equal(body.created, true);
		const bad = await app.request('/u2/articles/cms-9', { method: 'DELETE' }, e);
		assert.deepEqual(await bad.json(), { error: 'not_owner' });
		assert.equal((await app.request('/u1/articles/cms-10', { method: 'DELETE' }, e)).status, 404);
		assert.equal((await app.request('/u1/articles/cms-9', { method: 'DELETE' }, e)).status, 200);
	});
});
