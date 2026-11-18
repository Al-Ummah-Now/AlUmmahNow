/**
 * Channel RSS feeds for scheduler tools (wiki AUN-SOCIAL; owner 2026-11-14: "if someone uses hootsuite or
 * similar we need to be able help them somehow"): public items only, newest first, a thumbnail enclosure, and a
 * document that passes RSS 2.0 validation (required elements, well-formed, escaped, RFC 822 dates, self link).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, videoFixture } from './helpers';
import { buildRss, feedItems, previewItems, xml, FEED_ITEMS } from '../src/lib/social/feed';

const WEB = 'https://videos.example.test';

/** Well-formedness: every element closed in order, attributes quoted, no raw `&` or `<` in text. */
function assertWellFormed(doc: string) {
	assert.ok(doc.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML declaration');
	const body = doc.replace(/^<\?xml[^>]*\?>/, '');
	const stack: string[] = [];
	const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
	let last = 0;
	for (let m = tag.exec(body); m; m = tag.exec(body)) {
		const text = body.slice(last, m.index);
		assert.ok(!/<|&(?!(amp|lt|gt|quot|apos);)/.test(text), `unescaped text: ${text.slice(0, 60)}`);
		last = tag.lastIndex;
		if (m[4]) continue;
		if (m[1]) assert.equal(stack.pop(), m[2], `closing </${m[2]}>`);
		else stack.push(m[2]);
	}
	assert.ok(!/<|&(?!(amp|lt|gt|quot|apos);)/.test(body.slice(last)), 'trailing text');
	assert.deepEqual(stack, [], 'all elements closed');
}

const RFC822 = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** The RSS 2.0 rules a feed validator checks. */
function assertValidRss(doc: string) {
	assertWellFormed(doc);
	assert.match(doc, /<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom" xmlns:media="http:\/\/search\.yahoo\.com\/mrss\/">/);
	const channel = doc.split('<item>')[0]!;
	for (const el of ['title', 'link', 'description']) assert.match(channel, new RegExp(`<${el}>[^<]+</${el}>`), `channel <${el}>`);
	assert.match(channel, /<atom:link href="https:\/\/[^"]+" rel="self" type="application\/rss\+xml"\/>/);
	for (const d of [...doc.matchAll(/<(?:pubDate|lastBuildDate)>([^<]+)</g)].map((m) => m[1]!)) assert.match(d, RFC822);
	for (const item of doc.split('<item>').slice(1)) {
		assert.match(item, /<title>[^<]+<\/title>/);
		assert.match(item, /<link>https:\/\/[^<]+<\/link>/);
		assert.match(item, /<guid isPermaLink="false">[^<]+<\/guid>/);
		const enclosure = /<enclosure ([^>]+)\/>/.exec(item);
		if (enclosure) {
			assert.match(enclosure[1]!, /url="https:\/\/[^"]+"/);
			assert.match(enclosure[1]!, /length="\d+"/);
			assert.match(enclosure[1]!, /type="image\/jpeg"/);
		}
	}
}

function setup() {
	const db = new SqliteD1();
	const channels = new MemoryBucket({
		ch1: { id: 'ch1', name: 'Noor & Friends', nameLocalized: { ar: 'نور وأصحابه' }, handle: 'noor' },
		gone: { id: 'gone', name: 'Gone', isSuspended: true },
	});
	const videos = new MemoryBucket({
		v1: videoFixture({ id: 'v1', channelId: 'ch1', title: 'Tafsir <part 1> & notes', titleLocalized: { ar: 'تفسير' }, publishedAt: '2026-11-10T10:00:00.000Z' }),
		v2: videoFixture({ id: 'v2', channelId: 'ch1', title: 'Second', publishedAt: '2026-11-12T10:00:00.000Z' }),
		s1: videoFixture({ id: 's1', channelId: 'ch1', title: 'A Short', isShort: true, width: 1080, height: 1920, duration: 30, publishedAt: '2026-11-11T10:00:00.000Z' }),
		hidden: videoFixture({ id: 'hidden', channelId: 'ch1', title: 'Made private', isPublic: false }),
	});
	const posts = new MemoryBucket({
		'posts/ch1/p1.json': { id: 'p1', channelId: 'ch1', content: 'Jumuah reminder\nsecond line', status: 'published', visibility: 'public', createdAt: '2026-11-13T09:00:00.000Z' },
	});
	const row = (table: string, id: string, at: string, isShort = 0) =>
		db.db.prepare(`INSERT INTO ${table} (id, channel_id, visible, created_at, payload, is_short) VALUES (?, 'ch1', 1, ?, '{}', ?)`).run(id, Date.parse(at), isShort);
	row('search_videos', 'v1', '2026-11-10T10:00:00Z');
	row('search_videos', 'v2', '2026-11-12T10:00:00Z');
	row('search_videos', 's1', '2026-11-11T10:00:00Z', 1);
	// Indexed while public, private since: left out at read time
	row('search_videos', 'hidden', '2026-11-13T10:00:00Z');
	row('search_posts', 'p1', '2026-11-13T09:00:00Z');
	const env = { SEARCH_DB: db, channels, videos, community_posts: posts, VIDEOS_WEB_URL: WEB } as never;
	return { env };
}

describe('channel feeds', () => {
	it('lists public items of the kind, newest first, with the thumbnail enclosure', async () => {
		const { env } = setup();
		const all = (await feedItems(env, 'ch1', 'all'))!;
		assert.deepEqual(all.items.map((i) => i.content.entityId), ['p1', 'v2', 's1', 'v1']);
		const videos = (await feedItems(env, 'ch1', 'videos'))!;
		assert.deepEqual(videos.items.map((i) => i.content.entityId), ['v2', 'v1']);
		assert.deepEqual((await feedItems(env, 'ch1', 'shorts'))!.items.map((i) => i.content.entityId), ['s1']);
		assert.deepEqual((await feedItems(env, 'ch1', 'posts'))!.items.map((i) => i.content.entityId), ['p1']);
		assert.equal(await feedItems(env, 'gone', 'all'), null);
		assert.equal(await feedItems(env, 'missing', 'all'), null);
	});

	it("gives Studio's post preview the newest public item of each kind, skipping ones made private", async () => {
		const { env } = setup();
		const p = (await previewItems(env, 'ch1'))!;
		assert.deepEqual(p.channel, { en: 'Noor & Friends', ar: 'نور وأصحابه' });
		assert.deepEqual(p.channelUrl, { en: `${WEB}/en/@noor`, ar: `${WEB}/ar/@noor` });
		assert.equal(p.items.video?.title.en, 'Second');
		assert.equal(p.items.short?.title.en, 'A Short');
		assert.equal(p.items.post?.text, 'Jumuah reminder\nsecond line');
		assert.equal(p.items.live, undefined);
		assert.equal(await previewItems(env, 'gone'), null);
	});

	it('builds a valid RSS 2.0 document, in English and Arabic', async () => {
		const { env } = setup();
		const feed = (await feedItems(env, 'ch1', 'all'))!;
		const en = buildRss(feed, 'all', 'en', `${WEB}/feeds/ch1/all.xml`);
		assertValidRss(en);
		assert.match(en, /<title>Noor &amp; Friends<\/title>/);
		assert.match(en, /<title>Tafsir &lt;part 1&gt; &amp; notes<\/title>/);
		assert.match(en, new RegExp(`<link>${WEB}/en/video/v1</link>`));
		assert.match(en, new RegExp(`<link>${WEB}/en/shorts/s1</link>`));
		assert.match(en, new RegExp(`<link>${WEB}/en/post/p1</link>`));
		assert.match(en, new RegExp(`<enclosure url="${WEB}/thumb/v1.jpg" length="0" type="image/jpeg"/>`));
		assert.match(en, /<media:thumbnail url="[^"]+\/thumb\/s1\.jpg"\/>/);
		assert.match(en, /<pubDate>Thu, 12 Nov 2026 10:00:00 GMT<\/pubDate>/);
		assert.match(en, /<description>Jumuah reminder\nsecond line<\/description>/);

		const ar = buildRss((await feedItems(env, 'ch1', 'videos'))!, 'videos', 'ar', `${WEB}/feeds/ch1/videos.xml?lang=ar`);
		assertValidRss(ar);
		assert.match(ar, /<title>نور وأصحابه · المرئيات<\/title>/);
		assert.match(ar, /<language>ar<\/language>/);
		assert.match(ar, /<title>تفسير<\/title>/);
		assert.match(ar, new RegExp(`<link>${WEB}/ar/video/v1</link>`));
		assert.match(ar, new RegExp(`<link>${WEB}/ar/@noor</link>`));
	});

	it('an empty channel still gives a valid feed', async () => {
		const { env } = setup();
		const feed = (await feedItems(env, 'ch1', 'live'))!;
		assert.equal(feed.items.length, 0);
		assertValidRss(buildRss(feed, 'live', 'en', `${WEB}/feeds/ch1/live.xml`, Date.parse('2026-11-14T00:00:00Z')));
	});

	it('escapes markup and drops characters XML forbids', () => {
		assert.equal(xml(`a&b<c>"d"'e'\u0001f`), 'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;f');
		assert.ok(FEED_ITEMS <= 50);
	});
});
