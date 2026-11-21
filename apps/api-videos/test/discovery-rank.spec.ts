/** Discovery ranking (wiki E07 "Discovery ranking"): pure scoring, cold start first. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	DAY_MS,
	MIN_SIGNAL_ITEMS,
	applyPins,
	blendedScore,
	buildFeatured,
	buildNew,
	buildPopular,
	buildTop,
	buildTrending,
	diversify,
	freshnessScore,
	isRailEligible,
	priorScore,
	qualityScore,
	railHash,
	windowSignal,
	WINDOW_PARAMS,
	type Engagement,
	type RankInputs,
	type RankVideo,
} from '../src/lib/ranking/rank';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const ctx = { now: NOW, featuredChannels: new Set<string>() };

function video(id: string, over: Partial<RankVideo> = {}): RankVideo {
	return {
		id,
		channelId: 'c1',
		category: 'quran',
		language: 'ar',
		isShort: false,
		isLive: false,
		duration: 600,
		addedAt: NOW - 2 * DAY_MS,
		publishedAt: NOW - 2 * DAY_MS,
		hasThumbnail: true,
		bilingualTitle: false,
		hasDescription: true,
		hasCaptions: false,
		channelVerified: false,
		excluded: false,
		...over,
	};
}

function inputs(videos: RankVideo[], engagement: Record<string, Engagement> = {}, featured: string[] = []): RankInputs {
	return { videos, engagement: new Map(Object.entries(engagement)), ctx: { now: NOW, featuredChannels: new Set(featured) } };
}

/** `n` unique viewers today. */
const viewed = (n: number, likes = 0, comments = 0): Engagement => [{ age: 0, viewers: n, likes, comments }];

/** A bulk import: `n` videos of one channel that arrived today with old original dates. */
function bulkImport(channelId: string, n: number, over: Partial<RankVideo> = {}): RankVideo[] {
	return Array.from({ length: n }, (_, i) =>
		video(`${channelId}-${i}`, { channelId, addedAt: NOW - 3_600_000 - i * 60_000, publishedAt: Date.parse('2014-03-01') + i * DAY_MS, ...over }),
	);
}

describe('eligibility and the engagement-free prior', () => {
	it('drops test/excluded, live, thumbnail-less and duration-less videos from every rail', () => {
		assert.equal(isRailEligible(video('ok')), true);
		assert.equal(isRailEligible(video('t', { excluded: true })), false);
		assert.equal(isRailEligible(video('l', { isLive: true })), false);
		assert.equal(isRailEligible(video('n', { hasThumbnail: false })), false);
		assert.equal(isRailEligible(video('d', { duration: 0 })), false);
		const rail = buildNew(inputs([video('ok'), video('t', { excluded: true }), video('n', { hasThumbnail: false })]), { limit: 10 });
		assert.deepEqual(rail.items.map((i) => i.id), ['ok']);
	});

	it('rates verified, captioned, bilingual videos higher with no engagement at all', () => {
		const plain = video('plain', { hasDescription: false });
		const best = video('best', { channelVerified: true, hasCaptions: true, bilingualTitle: true });
		assert.ok(qualityScore(best) > qualityScore(plain));
		assert.equal(qualityScore(best), 1);
		assert.ok(priorScore(best, ctx) > priorScore(plain, ctx));
	});

	it('treats an old import that arrived today as fresh (arrival date weighs most)', () => {
		const oldImport = video('imp', { addedAt: NOW - 3_600_000, publishedAt: Date.parse('2012-01-01') });
		const oldUpload = video('old', { addedAt: Date.parse('2026-06-01'), publishedAt: Date.parse('2026-06-01') });
		assert.ok(freshnessScore(oldImport, NOW) > 0.7);
		assert.ok(freshnessScore(oldImport, NOW) > freshnessScore(oldUpload, NOW));
	});

	it('gives channels an admin featured a boost', () => {
		const v = video('v', { channelId: 'scholar' });
		assert.ok(priorScore(v, { now: NOW, featuredChannels: new Set(['scholar']) }) > priorScore(v, ctx));
	});
});

describe('engagement signal and confidence', () => {
	it('never lets one or two views qualify (the owner, a tester)', () => {
		for (const window of ['day', 'week', 'month'] as const) {
			assert.equal(windowSignal(viewed(2), WINDOW_PARAMS[window]).qualified, false, window);
		}
		assert.equal(windowSignal(viewed(5), WINDOW_PARAMS.week).qualified, true);
	});

	it('ignores engagement outside the window and decays it inside', () => {
		const old: Engagement = [{ age: 8, viewers: 50, likes: 10, comments: 5 }];
		assert.equal(windowSignal(old, WINDOW_PARAMS.week).viewers, 0);
		const today = windowSignal([{ age: 0, viewers: 10, likes: 0, comments: 0 }], WINDOW_PARAMS.week);
		const sixDays = windowSignal([{ age: 6, viewers: 10, likes: 0, comments: 0 }], WINDOW_PARAMS.week);
		assert.ok(today.value > sixDays.value);
	});

	it('blends: no viewers = the prior; more viewers move the score up steadily', () => {
		const prior = 0.6;
		assert.equal(blendedScore(windowSignal([], WINDOW_PARAMS.week), prior), prior);
		const one = blendedScore(windowSignal(viewed(1), WINDOW_PARAMS.week), prior);
		const ten = blendedScore(windowSignal(viewed(10), WINDOW_PARAMS.week), prior);
		const hundred = blendedScore(windowSignal(viewed(100), WINDOW_PARAMS.week), prior);
		assert.ok(one - prior < 0.1, 'one view barely moves it');
		assert.ok(ten > one && hundred > ten);
	});
});

describe('zero engagement (prod today): every rail still fills and relabels honestly', () => {
	const library = [...bulkImport('scholarA', 20), ...bulkImport('scholarB', 4), ...bulkImport('scholarC', 2)];

	it('Trending this week becomes "New this week" with the newest arrivals, mixed across channels', () => {
		const rail = buildTrending(inputs(library), 'week', { limit: 12 });
		assert.equal(rail.mode, 'new');
		assert.equal(rail.label, 'new_this_week');
		assert.equal(rail.signalItems, 0);
		assert.equal(rail.items.length, 12);
		const firstSix = rail.items.slice(0, 6).map((i) => i.id.split('-')[0]);
		assert.ok(new Set(firstSix).size === 3, `three channels in the first six: ${firstSix}`);
	});

	it('Trending today says "New today" only when enough arrived today, else widens', () => {
		assert.equal(buildTrending(inputs(library), 'day', { limit: 12 }).label, 'new_today');
		const lastWeek = library.map((v) => ({ ...v, addedAt: NOW - 3 * DAY_MS }));
		assert.equal(buildTrending(inputs(lastWeek), 'day', { limit: 12 }).label, 'new_this_week');
		const lastYear = library.map((v) => ({ ...v, addedAt: NOW - 300 * DAY_MS }));
		const rail = buildTrending(inputs(lastYear), 'month', { limit: 12 });
		assert.equal(rail.label, 'latest');
		assert.equal(rail.items.length, 12);
	});

	it('Popular becomes "Featured", led by verified and complete videos', () => {
		const verified = video('verified', { channelId: 'v', channelVerified: true, hasCaptions: true, bilingualTitle: true, addedAt: NOW - 20 * DAY_MS });
		const rail = buildPopular(inputs([...library, verified]), { limit: 12 });
		assert.equal(rail.mode, 'featured');
		assert.equal(rail.label, 'featured');
		assert.equal(rail.items[0].id, 'verified');
	});

	it('the owner watching their own uploads (2 views each) changes nothing', () => {
		const ownerViews = Object.fromEntries(library.map((v) => [v.id, viewed(2)]));
		const cold = buildTrending(inputs(library), 'week', { limit: 12 });
		const owner = buildTrending(inputs(library, ownerViews), 'week', { limit: 12 });
		assert.equal(owner.mode, 'new');
		assert.deepEqual(owner.items.map((i) => i.id), cold.items.map((i) => i.id));
	});

	it('Top (Explore, categories) orders by the prior and fills', () => {
		const rail = buildTop(inputs(library), { limit: 10, category: 'quran' });
		assert.equal(rail.items.length, 10);
		assert.equal(rail.signalItems, 0);
	});
});

describe('with real signal', () => {
	it('Trending switches on once enough videos have qualified viewers, ranked by engagement', () => {
		const library = bulkImport('a', 6).concat(bulkImport('b', 6));
		const engagement: Record<string, Engagement> = {};
		library.forEach((v, i) => (engagement[v.id] = viewed(5 + i)));
		const rail = buildTrending(inputs(library, engagement), 'week', { limit: 12 });
		assert.equal(rail.mode, 'trending');
		assert.equal(rail.label, 'trending_this_week');
		assert.equal(rail.signalItems, 12);
		assert.equal(rail.items[0].id, 'b-5', 'the most watched first');
		assert.ok(rail.items.every((i) => i.reason === 'trending'));
	});

	it(`stays "New" with fewer than ${MIN_SIGNAL_ITEMS} qualified videos and reports how many it saw`, () => {
		const library = bulkImport('a', 10);
		const engagement = { 'a-0': viewed(50), 'a-1': viewed(50) };
		const rail = buildTrending(inputs(library, engagement), 'week', { limit: 12 });
		assert.equal(rail.mode, 'new');
		assert.equal(rail.signalItems, 2);
	});

	it('Popular switches on with enough 90-day viewers', () => {
		const library = bulkImport('a', 8);
		const engagement = Object.fromEntries(library.map((v, i) => [v.id, [{ age: 40, viewers: 20 + i, likes: 2, comments: 1 }] as Engagement]));
		const rail = buildPopular(inputs(library, engagement), { limit: 8 });
		assert.equal(rail.mode, 'popular');
		assert.equal(rail.items[0].id, 'a-7');
	});
});

describe('channel diversity', () => {
	it('one channel’s bulk import cannot fill the top of a rail', () => {
		const library = [...bulkImport('big', 30, { channelVerified: true, hasCaptions: true }), ...bulkImport('small', 3)];
		const rail = buildNew(inputs(library), { limit: 12 });
		const top6 = rail.items.slice(0, 6).filter((i) => i.id.startsWith('small'));
		assert.ok(top6.length >= 2, `small channel in the first six: ${rail.items.map((i) => i.id)}`);
	});

	it('still fills from a single channel', () => {
		const out = diversify(bulkImport('only', 5).map((v, i) => ({ v, score: 1 - i * 0.1, reason: 'fresh' as const })), 10);
		assert.deepEqual(out.map((s) => s.v.id), ['only-0', 'only-1', 'only-2', 'only-3', 'only-4']);
	});
});

describe('language scope', () => {
	it('boosts the viewer’s language without dropping the other', () => {
		const library = [video('en1', { language: 'en', channelId: 'e' }), video('ar1', { language: 'ar', channelId: 'a' }), video('un', { language: null, channelId: 'u' })];
		const ar = buildTop(inputs(library), { limit: 3, language: 'ar' });
		assert.deepEqual(ar.items.map((i) => i.id), ['ar1', 'un', 'en1']);
		const en = buildTop(inputs(library), { limit: 3, language: 'en' });
		assert.equal(en.items[0].id, 'en1');
	});
});

describe('Shorts and categories', () => {
	it('leaves Shorts out when asked and limits to the category', () => {
		const library = [video('s', { isShort: true, channelId: 'x' }), video('v', { channelId: 'y' }), video('f', { category: 'fiqh', channelId: 'z' })];
		assert.deepEqual(buildTop(inputs(library), { limit: 5, excludeShorts: true, category: 'quran' }).items.map((i) => i.id), ['v']);
	});
});

describe('admin pins', () => {
	const library = [...bulkImport('a', 5), ...bulkImport('b', 5), video('hidden', { hasThumbnail: false, channelId: 'c' }), video('pinme', { channelId: 'p', addedAt: NOW - 200 * DAY_MS })];

	it('places pinned videos and channels in their slots, skipping ineligible pins', () => {
		const rail = buildNew(inputs(library), {
			limit: 8,
			pins: [
				{ kind: 'video', targetId: 'pinme', position: 1 },
				{ kind: 'video', targetId: 'hidden', position: 2 },
				{ kind: 'channel', targetId: 'b', position: 3 },
			],
		});
		assert.equal(rail.items[0].id, 'pinme');
		assert.equal(rail.items[0].reason, 'pinned');
		assert.ok(!rail.items.some((i) => i.id === 'hidden'));
		assert.equal(rail.items[2].reason, 'pinned');
		assert.ok(rail.items[2].id.startsWith('b-'));
		assert.equal(rail.items.length, 8);
		assert.equal(new Set(rail.items.map((i) => i.id)).size, 8, 'no duplicates');
	});

	it('a pin beyond the end of a short list is appended', () => {
		const items = [{ id: 'x', score: 1, reason: 'fresh' as const }];
		const pool = new Map([['x', video('x')], ['y', video('y')]]);
		const out = applyPins(items, [{ kind: 'video', targetId: 'y', position: 10 }], pool, [], 5);
		assert.deepEqual(out.map((i) => i.id), ['x', 'y']);
	});

	it('Featured puts admin-featured channels first', () => {
		const rail = buildFeatured(inputs([video('x', { channelId: 'x' }), video('y', { channelId: 'y' })], {}, ['y']), { limit: 2 });
		assert.equal(rail.items[0].id, 'y');
	});
});

describe('railHash', () => {
	it('ignores score drift but sees order, label and membership changes', () => {
		const a = { mode: 'new' as const, label: 'latest' as const, signalItems: 0, items: [{ id: '1', score: 0.5, reason: 'fresh' as const }] };
		assert.equal(railHash(a), railHash({ ...a, items: [{ ...a.items[0], score: 0.49 }] }));
		assert.notEqual(railHash(a), railHash({ ...a, label: 'new_this_week' }));
		assert.notEqual(railHash(a), railHash({ ...a, items: [{ ...a.items[0], id: '2' }] }));
	});
});
