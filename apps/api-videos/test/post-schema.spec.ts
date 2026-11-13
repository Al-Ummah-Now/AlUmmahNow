/**
 * PostV2 (packages/shared-types/src/post-schema.ts): the one post format shared with the CMS and www.
 * The validator for Studio's fields, the summary the CMS caches, the fixtures, and the conversion of
 * CMS scholar posts into community posts (lib/scholar-articles.ts convertScholarPost).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POST_FIXTURES, POST_KINDS, isPublicPost, parsePostFields, postLocale, postSummary, postTitle, slugify } from '@al-ummah/shared-types';
import { MemoryBucket } from './helpers';
import { ArticleError, convertScholarPost, parseConvert, upsertArticle, parseArticle } from '../src/lib/scholar-articles';
import { platformMediaHost } from '../src/lib/post-v2';

const img = (n: number, alt = `Card ${n}`) => ({ url: `https://images.alummahnow.net/c/${n}.jpg`, alt, width: 1080, height: 1350 });

describe('post schema', () => {
	it('has a fixture for every kind, and every fixture summarises with a title or media', () => {
		for (const kind of POST_KINDS) {
			const s = postSummary(POST_FIXTURES[kind]);
			assert.equal(s.kind, kind);
			assert.ok(s.title || s.cover || s.gif, `${kind} has something to show`);
		}
		const cards = postSummary(POST_FIXTURES.cards);
		assert.equal(cards.slide_count, 3);
		assert.equal(cards.cover?.url, img(4).url.replace('/c/4', '/fixtures/4'));
	});

	it('checks article, cards and link fields', () => {
		const article = parsePostFields('article', { locale: 'ar', article: { title: ' عنوان ', body: 'نص', cover: img(1) } });
		assert.ok(!('error' in article));
		if (!('error' in article)) {
			assert.equal(article.value.article?.title, 'عنوان');
			assert.equal(article.value.article?.coverUrl, img(1).url);
			assert.equal(article.value.locale, 'ar');
		}
		assert.deepEqual(parsePostFields('article', { article: { title: 'x' } }), { ok: false, error: 'required', field: 'article.body' });
		assert.deepEqual(parsePostFields('cards', { title: 'x', slides: [{ image: img(1, '') }] }), { ok: false, error: 'alt_required', field: 'slides.0.image.alt' });
		assert.deepEqual(parsePostFields('cards', { title: 'x', slides: Array.from({ length: 41 }, (_, i) => ({ image: img(i) })) }), { ok: false, error: 'too_many', field: 'slides' });
		assert.deepEqual(parsePostFields('link', { link: { url: 'javascript:alert(1)' } }), { ok: false, error: 'bad_url', field: 'link.url' });
		const link = parsePostFields('link', { link: { url: 'http://example.org/a' } });
		assert.ok(!('error' in link));
		assert.deepEqual(parsePostFields('nope', {}), { ok: false, error: 'bad_kind', field: 'type' });
	});

	it('keeps images on platform hosts in production', () => {
		const prod = platformMediaHost({ ENVIRONMENT: 'production' });
		assert.equal(prod('images.alummahnow.net'), true);
		assert.equal(prod('cms.qa.alummahnow.net'), true);
		assert.equal(prod('evil.example'), false);
		assert.equal(prod('alummahnow.net.evil.example'), false);
		assert.equal(prod('localhost'), false);
		assert.equal(platformMediaHost({ ENVIRONMENT: 'qa' })('cdn.test'), true);
		const r = parsePostFields('cards', { title: 'x', slides: [{ image: { url: 'https://evil.example/a.jpg', alt: 'a' } }] }, { mediaHost: prod });
		assert.ok('error' in r && r.error === 'bad_media');
	});

	it('reads older posts: locale, title, slug and public state', () => {
		assert.equal(postLocale({ type: 'text', content: 'السلام عليكم ورحمة الله' }), 'ar');
		assert.equal(postLocale({ type: 'text', content: 'Hello' }), 'en');
		assert.equal(postTitle({ type: 'text', content: '<p>First line</p><p>Second</p>' }), 'First line');
		assert.equal(slugify('Ṣabr & Patience!'), 'sabr-patience');
		assert.equal(slugify('صبر'), '');
		assert.equal(isPublicPost({ status: 'published', visibility: 'public' }), true);
		assert.equal(isPublicPost({ status: 'published', visibility: 'members' }), false);
		assert.equal(isPublicPost({ status: 'deleted', visibility: 'public' }), false);
	});
});

function env() {
	return { channels: new MemoryBucket() as unknown as R2Bucket, community_posts: new MemoryBucket() as unknown as R2Bucket };
}
const postOf = async (e: ReturnType<typeof env>, ch: string, id: string) => (await (await e.community_posts.get(`posts/${ch}/${id}.json`))!.json()) as Record<string, any>;

describe('converting CMS scholar posts', () => {
	const www = { url: 'https://www.alummahnow.net/en/articles/on-patience/', slug: 'on-patience', locale: 'en' };

	it('upgrades a link-only mirror in place (same id) and ignores a late mirror call', async () => {
		const e = env();
		await e.channels.put('c1', JSON.stringify({ id: 'c1', userId: 'u1', name: 'C1' }));
		const mirror = await upsertArticle(e, 'u1', 'cms-7', parseArticle({ channelId: 'c1', title: 'On patience', excerpt: 'x', coverUrl: null, url: www.url, locale: 'en', publishedAt: null }));
		const input = parseConvert({ channelId: 'c1', kind: 'article', article: { title: 'On patience', body: '## Hi\n\nBody', excerpt: 'x' }, www, status: 'published', publishedAt: '2026-11-01T00:00:00Z' });
		const out = await convertScholarPost(e, 'u1', 'cms-7', input);
		assert.equal(out.upgraded, true);
		assert.equal(out.post.id, mirror.post.id);
		const saved = await postOf(e, 'c1', mirror.post.id);
		assert.equal(saved.article.body, '## Hi\n\nBody');
		assert.equal(saved.article.url, www.url);
		assert.equal(saved.article.externalId, 'cms-7');
		assert.deepEqual(saved.www, www);
		// The old CMS outbox must not undo the conversion
		await upsertArticle(e, 'u1', 'cms-7', parseArticle({ channelId: 'c1', title: 'Old', excerpt: null, coverUrl: null, url: www.url, locale: 'en', publishedAt: null }));
		assert.equal((await postOf(e, 'c1', mirror.post.id)).article.body, '## Hi\n\nBody');
		// Re-running is idempotent
		const again = await convertScholarPost(e, 'u1', 'cms-7', input);
		assert.equal(again.post.id, mirror.post.id);
	});

	it('creates a cards post, and refuses someone else\'s channel and bad bodies', async () => {
		const e = env();
		await e.channels.put('c1', JSON.stringify({ id: 'c1', userId: 'u1', name: 'C1' }));
		const input = parseConvert({ channelId: 'c1', kind: 'cards', title: 'Cards', slides: [{ id: 'a', image: img(1) }, { id: 'b', image: img(2) }], www: { ...www, slug: 'cards' }, status: 'published', publishedAt: null });
		const out = await convertScholarPost(e, 'u1', 'cms-9', input);
		assert.equal(out.created, true);
		const saved = await postOf(e, 'c1', out.post.id);
		assert.equal(saved.type, 'cards');
		assert.equal(saved.slides.length, 2);
		assert.equal(saved.article, undefined);
		await assert.rejects(convertScholarPost(e, 'u2', 'cms-10', input), (err) => err instanceof ArticleError && err.code === 'not_owner');
		assert.throws(() => parseConvert({ channelId: 'c1', kind: 'cards', title: 'x', slides: [], www, status: 'published' }), (err) => err instanceof ArticleError);
		assert.throws(() => parseConvert({ channelId: 'c1', kind: 'article', article: { title: 'x', body: 'y' }, www: { ...www, url: 'http://x' } }), (err) => err instanceof ArticleError);
	});
});
