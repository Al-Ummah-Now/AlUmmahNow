/**
 * Discovery ranking end to end (wiki E07 "Discovery ranking"): the ranking job over a real
 * search index (node:sqlite with the search migrations, rows written by the real index sync)
 * and the notifications DB (the processor's migrations), then the rails served by the real
 * endpoints. The library is an admin bulk import with old original dates and no viewers:
 * the cold start the site has today.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncSearchDocument, VideoCategory } from '@al-ummah/shared-types';
import { runDiscoveryRank, readLastRun, isTestOwnerEmail } from '../src/lib/ranking/job';
import { railPage } from '../src/lib/ranking/serve';
import { dedupeHome, DiscoveryHome, MIN_HOME_ITEMS } from '../src/endpoints/discovery/home';
import { TrendingVideosSection } from '../src/endpoints/sections/trending';
import { PopularVideosSection } from '../src/endpoints/sections/popular';
import { TrendingGet } from '../src/endpoints/discovery/discovery';
import { SALT_KEY_PREFIX } from '../src/lib/ranking/viewer';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-21T12:00:00Z');
const CATEGORIES = Object.values(VideoCategory) as string[];

function video(i: number, overrides: Record<string, unknown> = {}) {
	return videoFixture({
		id: `v${String(i).padStart(3, '0')}`,
		title: `Video ${i}`,
		titleLocalized: { en: `Video ${i}`, ar: `مرئي ${i}` },
		userId: `owner${i % 6}`,
		channelId: `ch${i % 6}`,
		category: CATEGORIES[i % 3],
		thumbnailUrl: `https://img.test/${i}.jpg`,
		duration: 300 + i,
		// Imported this week, originally published years ago
		dateCreated: new Date(NOW - (i % 7) * DAY - i * 60_000).toISOString(),
		publishedAt: new Date(NOW - (400 + i) * DAY).toISOString(),
		uploadStatus: 'ready',
		isPublic: true,
		...overrides,
	});
}

async function library(n: number, overrides: (i: number) => Record<string, unknown> = () => ({})) {
	const search = new SqliteD1();
	const notifications = createSqliteD1();
	const videos: Record<string, any> = {};
	for (let i = 0; i < n; i++) {
		const v = video(i, overrides(i));
		videos[v.id] = v;
		await syncSearchDocument(search as never, 'video', v.id, v, { version: 1 });
	}
	const bucket = new MemoryBucket(videos);
	const env = { SEARCH_DB: search, NOTIFICATIONS_DB: notifications, videos: bucket } as any;
	return { search, notifications, env, videos: Object.values(videos) as any[] };
}

const rails = (search: SqliteD1) =>
	search.db.prepare("SELECT rail, scope, mode, label, items, signal_items FROM discovery_rails WHERE scope = '' ORDER BY rail").all() as Array<{
		rail: string;
		mode: string;
		label: string;
		items: number;
		signal_items: number;
	}>;

describe('discovery ranking job', () => {
	it('with no viewers at all: every rail is filled and labelled for what it is', async () => {
		const { search, env } = await library(40);
		const summary = await runDiscoveryRank(env, NOW);
		assert.equal(summary.videos, 40);
		assert.equal(summary.eligible, 40);
		assert.equal(summary.engaged, 0);
		const byRail = Object.fromEntries(rails(search).map((r) => [r.rail, r]));
		// Trending without viewers says what it is: the newest uploads
		assert.equal(byRail['trending:week'].mode, 'new');
		assert.equal(byRail['trending:week'].label, 'new_this_week');
		assert.equal(byRail['trending:week'].signal_items, 0);
		assert.equal(byRail.popular.label, 'featured');
		assert.equal(byRail.top.mode, 'top');
		for (const r of Object.values(byRail)) assert.ok(r.items > 0, r.rail);
		// Language and category scopes exist too
		const scopes = (search.db.prepare("SELECT DISTINCT scope FROM discovery_rails").all() as Array<{ scope: string }>).map((s) => s.scope);
		assert.ok(scopes.includes('lang:ar') && scopes.includes('lang:en'));
		assert.ok(scopes.includes(`cat:${CATEGORIES[0]}`));
		assert.equal((await readLastRun(env))?.videos, 40);
	});

	it('a second run with nothing changed writes no rail items', async () => {
		const { search, env } = await library(30);
		const first = await runDiscoveryRank(env, NOW);
		assert.ok(first.written > 0);
		const second = await runDiscoveryRank(env, NOW + 60_000);
		assert.equal(second.written, 0);
		assert.equal(second.unchanged, first.written + first.unchanged);
		assert.ok(rails(search).length > 0);
	});

	it('test and E2E accounts never reach a rail', async () => {
		const { search, env } = await library(24);
		assert.equal(isTestOwnerEmail('e2e+123-1-alice@e2e.alummahnow.net'), true);
		assert.equal(isTestOwnerEmail('test-signin-1@delivered.resend.dev'), true);
		assert.equal(isTestOwnerEmail('someone@example.com'), false);
		// owner1's videos belong to a run account (the ownership index: lib/search/ownership.ts)
		for (let i = 1; i < 24; i += 6) {
			search.db.prepare("INSERT OR REPLACE INTO content_ownership (kind, id, owner_id) VALUES ('video', ?, 'owner1')").run(`v${String(i).padStart(3, '0')}`);
		}
		search.db.prepare("INSERT INTO content_ownership (kind, id, email) VALUES ('profile', 'owner1', 'e2e+9-1-x@e2e.alummahnow.net') ON CONFLICT (kind, id) DO UPDATE SET email = excluded.email").run();
		const summary = await runDiscoveryRank(env, NOW);
		assert.equal(summary.excluded, 4);
		const ids = (search.db.prepare('SELECT DISTINCT video_id FROM discovery_rail_items').all() as Array<{ video_id: string }>).map((r) => r.video_id);
		assert.ok(ids.length > 0);
		assert.ok(ids.every((id) => Number(id.slice(1)) % 6 !== 1), 'a run account video is on a rail');
	});

	it('an admin exclusion keeps a channel off every rail', async () => {
		const { search, env } = await library(24);
		search.db.prepare("INSERT INTO discovery_exclusions (kind, target_id, created_by, created_at) VALUES ('channel', 'ch2', 'admin', 1)").run();
		await runDiscoveryRank(env, NOW);
		const ids = (search.db.prepare('SELECT DISTINCT video_id FROM discovery_rail_items').all() as Array<{ video_id: string }>).map((r) => r.video_id);
		assert.ok(ids.every((id) => Number(id.slice(1)) % 6 !== 2));
	});

	it('real viewers make Trending trending; owners and one-off views do not', async () => {
		const { search, notifications, env } = await library(30);
		const today = new Date(NOW).toISOString().slice(0, 10);
		// The processor writes these rows (lib/discovery-viewers.ts): one per distinct viewer per day
		const add = async (videoId: string, viewers: number) => {
			for (let k = 0; k < viewers; k++) {
				await notifications.prepare('INSERT OR IGNORE INTO discovery_viewers (day, video_id, viewer) VALUES (?, ?, ?)').bind(today, videoId, `a:${String(k).padStart(16, '0')}`).run();
			}
		};
		// Six videos with enough distinct viewers, one with two (never enough on its own)
		for (let i = 10; i < 16; i++) await add(`v0${i}`, 12 + i);
		await add('v020', 2);
		await runDiscoveryRank(env, NOW);
		const week = rails(search).find((r) => r.rail === 'trending:week')!;
		assert.equal(week.mode, 'trending');
		assert.equal(week.label, 'trending_this_week');
		assert.equal(week.signal_items, 6);
		const top = (search.db.prepare("SELECT video_id, reason FROM discovery_rail_items WHERE rail = 'trending:week' AND scope = '' ORDER BY position LIMIT 6").all() as Array<{ video_id: string }>).map((r) => r.video_id);
		assert.deepEqual([...top].sort(), ['v010', 'v011', 'v012', 'v013', 'v014', 'v015']);
	});

	it('removes viewer rows past the longest window and salts older than yesterday', async () => {
		const { search, notifications, env } = await library(10);
		await notifications.prepare('INSERT INTO discovery_viewers (day, video_id, viewer) VALUES (?, ?, ?)').bind('2026-01-01', 'v001', 'a:0000000000000000').run();
		await notifications.prepare('INSERT INTO discovery_viewers (day, video_id, viewer) VALUES (?, ?, ?)').bind('2026-11-20', 'v001', 'a:0000000000000000').run();
		for (const day of ['2026-11-18', '2026-11-20', '2026-11-21']) {
			search.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, 0)').run(`${SALT_KEY_PREFIX}${day}`, 'x');
		}
		await runDiscoveryRank(env, NOW);
		const days = ((await notifications.prepare('SELECT day FROM discovery_viewers').all()) as any).results.map((r: any) => r.day);
		assert.deepEqual(days, ['2026-11-20']);
		const salts = (search.db.prepare("SELECT key FROM search_meta WHERE key LIKE 'discovery:salt:%' ORDER BY key").all() as Array<{ key: string }>).map((r) => r.key);
		assert.deepEqual(salts, [`${SALT_KEY_PREFIX}2026-11-20`, `${SALT_KEY_PREFIX}2026-11-21`]);
	});
});

describe('content-language trending (Explore)', () => {
	it('/api/trending?language=ar lists only Arabic videos', async () => {
		const { search, env } = await library(30, (i) => (i % 3 === 0 ? { title: `درس في التفسير رقم ${i}`, titleLocalized: { ar: `درس في التفسير رقم ${i}` }, description: 'شرح مبسط للآيات' } : {}));
		await runDiscoveryRank(env, NOW);
		const languages = search.db.prepare("SELECT DISTINCT v.language FROM discovery_rail_items r JOIN search_videos v ON v.id = r.video_id WHERE r.rail = 'trending:week' AND r.scope = 'only:ar'").all() as Array<{ language: string }>;
		assert.deepEqual(languages.map((l) => l.language), ['ar']);
		const app = buildApp((r: any) => r.get('/api/trending', TrendingGet));
		const body = (await (await app.request('/api/trending?period=week&language=ar&limit=50', {}, env)).json()) as any;
		assert.equal(body.data.length, 10);
		assert.ok(body.data.every((v: any) => Number(v.id.slice(1)) % 3 === 0));
		assert.equal(body.rail.label, 'new_this_week');
	});
});

describe('serving ranked rails', () => {
	it('pages are full and follow the keyset cursor to the end, with no repeats', async () => {
		const { env } = await library(60);
		await runDiscoveryRank(env, NOW);
		const seen: string[] = [];
		let cursor: string | undefined;
		for (let guard = 0; guard < 20; guard++) {
			const page = await railPage(env, { rail: 'new', scope: '', limit: 12, cursor });
			assert.ok(page);
			if (page.nextCursor) assert.equal(page.entries.length, 12);
			seen.push(...page.entries.map((e) => e.video.id));
			cursor = page.nextCursor;
			if (!cursor) break;
		}
		assert.equal(seen.length, 60);
		assert.equal(new Set(seen).size, 60);
	});

	it('a video made private since the run is skipped and the page stays full', async () => {
		const { env } = await library(30);
		await runDiscoveryRank(env, NOW);
		const first = await railPage(env, { rail: 'new', scope: '', limit: 10 });
		const hidden = first!.entries[2].video.id;
		const stored = JSON.parse(env.videos.store.get(hidden));
		env.videos.store.set(hidden, JSON.stringify({ ...stored, isPublic: false }));
		const again = await railPage(env, { rail: 'new', scope: '', limit: 10 });
		assert.equal(again!.entries.length, 10);
		assert.ok(!again!.entries.some((e) => e.video.id === hidden));
	});

	it('before any run the rails read as missing (callers keep their index query)', async () => {
		const { env } = await library(5);
		assert.equal(await railPage(env, { rail: 'new', scope: '', limit: 10 }), null);
	});

	it('section endpoints serve the rails with their label, localized titles included', async () => {
		const { env } = await library(40);
		await runDiscoveryRank(env, NOW);
		const app = buildApp((r: any) => {
			r.get('/api/sections/trending', TrendingVideosSection);
			r.get('/api/sections/popular', PopularVideosSection);
		});
		const res = await app.request('/api/sections/trending?limit=12&window=week', {}, env);
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as any;
		assert.equal(body.data.length, 12);
		assert.equal(body.metadata.rail.label, 'new_this_week');
		assert.equal(body.data[0].titleLocalized.ar.startsWith('مرئي'), true);
		assert.ok(body.cursor);
		const popular = (await (await app.request('/api/sections/popular?limit=12', {}, env)).json()) as any;
		assert.equal(popular.metadata.rail.label, 'featured');
	});
});

describe('home rails', () => {
	it('with no viewers the home page has no repeated videos or headings', async () => {
		const { env } = await library(80);
		await runDiscoveryRank(env, NOW);
		const app = buildApp((r: any) => r.get('/api/discovery/home', DiscoveryHome));
		const res = await app.request('/api/discovery/home?limit=8&language=en', {}, env);
		assert.equal(res.status, 200, await res.clone().text());
		const { data } = (await res.json()) as any;
		assert.ok(data.rails.length >= 2);
		const ids = data.rails.flatMap((r: any) => r.data.map((v: any) => v.id));
		assert.equal(new Set(ids).size, ids.length);
		const headings = data.rails.filter((r: any) => r.key !== 'categories').map((r: any) => r.info.label);
		assert.equal(new Set(headings).size, headings.length);
		for (const r of data.rails) assert.ok(r.data.length >= MIN_HOME_ITEMS);
	});

	it('the admin order and switches decide the rails', async () => {
		const { search, env } = await library(80);
		await runDiscoveryRank(env, NOW);
		search.db.exec("INSERT INTO discovery_home_rails (rail, position, enabled, updated_at) VALUES ('new', 1, 1, 0), ('featured', 2, 0, 0), ('trending', 3, 1, 0), ('popular', 4, 1, 0), ('categories', 5, 0, 0)");
		const app = buildApp((r: any) => r.get('/api/discovery/home', DiscoveryHome));
		const { data } = (await (await app.request('/api/discovery/home?limit=8', {}, env)).json()) as any;
		assert.equal(data.rails[0].key, 'new');
		assert.ok(!data.rails.some((r: any) => r.key === 'featured' || r.key === 'categories'));
	});

	it('dedupeHome drops a rail that would show fewer than the minimum', () => {
		const entry = (id: string) => ({ video: { id } as any, position: 1, reason: 'prior' as const, score: 1 });
		const meta = (label: string) => ({ rail: 'new' as const, scope: '', mode: 'new' as const, label: label as any, items: 5, signalItems: 0, computedAt: '' });
		const out = dedupeHome(
			[
				{ key: 'featured', rail: 'featured', page: { meta: meta('featured'), entries: ['a', 'b', 'c', 'd', 'e'].map(entry) } },
				{ key: 'new', rail: 'new', page: { meta: meta('new_this_week'), entries: ['a', 'b', 'c', 'f', 'g'].map(entry) } },
			],
			12,
		);
		assert.deepEqual(out.map((r) => r.key), ['featured']);
	});
});
