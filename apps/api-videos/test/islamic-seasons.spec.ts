/**
 * Admin-curated Islamic seasons (wiki Epic 21 §4 21.2, §5.3): bilingual text required, optimistic
 * versions, soft delete with restore and a 30-day purge, the public active-season read, and
 * indexed queries only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IslamicSeasonGet } from '../src/endpoints/prayer/season';
import { activeSeason, createSeason, deleteSeason, listSeasons, purgeSeasons, restoreSeason, SeasonError, updateSeason, validDate, type SeasonInput } from '../src/lib/islamic-seasons';
import { forgetFeatureSwitches, writeFeatureSwitch } from '@al-ummah/shared-types';
import { computeFeatures, featureSwitchState, forgetFeatureCaches } from '../src/lib/features';
import { SqliteD1 } from './search-sqlite-d1';
import { buildApp } from './helpers';

const RAMADAN: SeasonInput = {
	kind: 'ramadan',
	title: { en: 'Ramadan', ar: 'رمضان' },
	source: { en: 'Announcement of the national moon-sighting committee', ar: 'إعلان لجنة الرؤية الوطنية' },
	startsOn: '2027-02-08',
	endsOn: '2027-03-09',
	items: [{ type: 'playlist', id: 'pl-1' }, { type: 'video', id: 'v-1' }],
};

describe('Islamic seasons', () => {
	it('needs English and Arabic text and a sane date range', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		await assert.rejects(createSeason(db, { ...RAMADAN, title: { en: 'Ramadan', ar: '' } }, 'admin-1'), SeasonError);
		await assert.rejects(createSeason(db, { ...RAMADAN, source: { en: '', ar: 'مصدر' } }, 'admin-1'), SeasonError);
		await assert.rejects(createSeason(db, { ...RAMADAN, endsOn: '2027-02-01' }, 'admin-1'), SeasonError);
		await assert.rejects(createSeason(db, { ...RAMADAN, endsOn: '2027-06-01' }, 'admin-1'), SeasonError);
	});

	it('is public only once published, during its dates, with items in order', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const draft = await createSeason(db, RAMADAN, 'admin-1');
		assert.equal(draft.state, 'draft');
		assert.equal(await activeSeason(db, '2027-02-10'), null);
		const { season } = await updateSeason(db, draft.id, draft.version, { ...RAMADAN, state: 'published' }, 'admin-2');
		assert.equal(season.version, 2);
		assert.equal(season.updatedBy, 'admin-2');
		assert.deepEqual((await activeSeason(db, '2027-02-10'))?.items, RAMADAN.items);
		assert.equal(await activeSeason(db, '2027-02-07'), null);
		assert.equal(await activeSeason(db, '2027-03-10'), null);
		await assert.rejects(updateSeason(db, draft.id, 1, RAMADAN, 'admin-3'), (e: unknown) => e instanceof SeasonError && e.status === 409);

		const res = await buildApp((r) => r.get('/api/islamic/season', IslamicSeasonGet), null).request('/api/islamic/season?date=2027-02-10', {}, { SEARCH_DB: db } as never);
		const body = (await res.json()) as any;
		assert.equal(body.data.season.title.ar, 'رمضان');
		assert.equal(body.data.season.source.en, RAMADAN.source.en);
		assert.equal('updatedBy' in body.data.season, false, 'no admin id in the public answer');
		const none = await buildApp((r) => r.get('/api/islamic/season', IslamicSeasonGet), null).request('/api/islamic/season?date=2027-06-01', {}, { SEARCH_DB: db } as never);
		assert.deepEqual(((await none.json()) as any).data, { season: null });
	});

	it('soft deletes, restores, and purges after 30 days', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const s = await createSeason(db, RAMADAN, 'admin-1');
		await updateSeason(db, s.id, 1, { ...RAMADAN, state: 'published' }, 'admin-1');
		const deleted = await deleteSeason(db, s.id, 'admin-1', new Date('2027-01-01T00:00:00Z'));
		assert.ok(deleted?.deletedAt);
		assert.equal(await activeSeason(db, '2027-02-10'), null);
		assert.equal((await listSeasons(db)).items.length, 0);
		assert.equal((await listSeasons(db, { deleted: true })).items.length, 1);
		await restoreSeason(db, s.id, 'admin-1');
		assert.ok(await activeSeason(db, '2027-02-10'));
		await deleteSeason(db, s.id, 'admin-1', new Date('2027-01-01T00:00:00Z'));
		assert.deepEqual(await purgeSeasons(db, '2027-01-15T00:00:00Z'), []);
		assert.deepEqual(await purgeSeasons(db, '2027-02-01T00:00:00Z'), [s.id]);
		const left = await db.prepare('SELECT COUNT(*) AS n FROM islamic_season_items WHERE season_id = ?').bind(s.id).first<{ n: number }>();
		assert.equal(left?.n, 0);
	});

	it('refuses impossible dates, bad cursors and odd limits instead of failing', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		assert.equal(validDate('2027-02-29'), false);
		assert.equal(validDate('2028-02-29'), true);
		assert.equal(validDate('2027-99-99'), false);
		await assert.rejects(activeSeason(db, '2027-99-99'), (e: unknown) => e instanceof SeasonError && e.status === 400);
		await assert.rejects(createSeason(db, { ...RAMADAN, startsOn: '2027-02-30' }, 'admin-1'), SeasonError);
		await assert.rejects(listSeasons(db, { cursor: 'nopipe' }), (e: unknown) => e instanceof SeasonError && e.status === 400);
		await assert.rejects(listSeasons(db, { cursor: '2027-99-99|x' }), SeasonError);
		assert.deepEqual((await listSeasons(db, { limit: Number('abc') })).items, []);
		const res = await buildApp((r) => r.get('/api/islamic/season', IslamicSeasonGet), null).request('/api/islamic/season?date=2027-99-99', {}, { SEARCH_DB: db } as never);
		assert.equal(res.status, 400);
	});

	it('/api/me/features shows Ramadan mode once switched on, and the admin readiness needs a published season', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const env = { SEARCH_DB: db } as never;
		forgetFeatureSwitches();
		forgetFeatureCaches();
		for (const key of ['prayerTimes', 'hijriCalendar', 'ramadanMode']) await writeFeatureSwitch(env, { key, enabled: true, expectedVersion: 0, actorId: 'admin-1' });
		forgetFeatureSwitches();
		assert.equal((await computeFeatures(env, { userId: null })).ramadanMode, true);
		const before = await featureSwitchState(env);
		assert.equal(before.ready.ramadanMode, false);
		const s = await createSeason(db, RAMADAN, 'admin-1');
		await updateSeason(db, s.id, 1, { ...RAMADAN, state: 'published' }, 'admin-1');
		const after = await featureSwitchState(env);
		assert.equal(after.ready.ramadanMode, true);
		forgetFeatureSwitches();
	});

	it('reads an index for the public and admin lists', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		for (const sql of [
			"SELECT id FROM islamic_seasons WHERE state = 'published' AND starts_on <= '2027-02-10' AND starts_on >= '2026-12-12' AND ends_on >= '2027-02-10' AND deleted_at IS NULL ORDER BY starts_on DESC, id DESC LIMIT 1",
			"SELECT id FROM islamic_seasons WHERE purge_after IS NOT NULL AND purge_after <= '2027-01-01' LIMIT 50",
		]) {
			const { results } = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>();
			assert.match((results ?? []).map((r) => r.detail).join(' | '), /USING (COVERING )?INDEX idx_islamic_seasons_/, sql);
		}
	});
});
