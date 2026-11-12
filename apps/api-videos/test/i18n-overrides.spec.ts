/**
 * #982: the translation store must not mask repo copy changes. Only keys an
 * admin edited (the stored file's `overrides`) win over the repo's static
 * translations; every other key is served from the repo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	AR_TRANSLATIONS,
	EN_TRANSLATIONS,
	applyTranslationOverrides,
	differingTranslationPaths,
	effectiveOverrides,
	nextTranslationOverrides,
} from '@al-ummah/shared-types';
import { GetTranslationsEndpoint } from '../src/endpoints/i18n/translationsGet';
import { SyncTranslationsEndpoint } from '../src/endpoints/i18n/translationsSync';
import { MemoryBucket, buildApp } from './helpers';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A store copied from an older build: `a11y.goToHomePage` still holds the old Arabic label. */
function staleArabic() {
	const translations = clone(AR_TRANSLATIONS) as any;
	translations.a11y.goToHomePage = 'الصفحة الرئيسية للأمة الآن';
	return translations;
}

function routes(r: any) {
	r.get('/api/i18n/translations/:locale', GetTranslationsEndpoint);
	r.post('/api/i18n/sync', SyncTranslationsEndpoint);
}

async function get(bucket: MemoryBucket, locale: 'en' | 'ar', headers: Record<string, string> = {}) {
	const res = await buildApp(routes, null).request(`/api/i18n/translations/${locale}`, { headers }, { global_settings: bucket } as any);
	return { status: res.status, etag: res.headers.get('etag'), body: res.status === 200 ? ((await res.json()) as any) : null };
}

describe('GET /api/i18n/translations: repo text reaches an existing store (#982)', () => {
	it('serves the repo value for a key nobody edited, even when the stored copy is stale', async () => {
		const bucket = new MemoryBucket({
			'translations/ar.json': { version: '1.0.81', locale: 'ar', updatedAt: 'x', translations: staleArabic(), overrides: [] },
		});
		const { status, body } = await get(bucket, 'ar');
		assert.equal(status, 200);
		assert.equal(body.result.translations.a11y.goToHomePage, AR_TRANSLATIONS.a11y.goToHomePage);
		assert.deepEqual(body.result.translations, AR_TRANSLATIONS);
		assert.deepEqual(body.result.overrides, []);
	});

	it('serves keys the store lacks from the repo (new keys reach the store on read)', async () => {
		const bucket = new MemoryBucket({
			'translations/en.json': { version: '1.0.1', locale: 'en', updatedAt: 'x', translations: { common: { save: 'Keep' } }, overrides: ['common.save'] },
		});
		const { body } = await get(bucket, 'en');
		assert.equal(body.result.translations.common.save, 'Keep');
		assert.equal(body.result.translations.a11y.goToHomePage, EN_TRANSLATIONS.a11y.goToHomePage);
	});

	it('keeps an admin-edited key after a deploy changes the repo text', async () => {
		const stored = staleArabic();
		stored.common.save = 'احفظ الآن';
		const bucket = new MemoryBucket({
			'translations/ar.json': { version: '1.0.82', locale: 'ar', updatedAt: 'x', translations: stored, overrides: ['common.save'] },
		});
		const { body } = await get(bucket, 'ar');
		assert.equal(body.result.translations.common.save, 'احفظ الآن', 'the admin edit wins');
		assert.equal(body.result.translations.a11y.goToHomePage, AR_TRANSLATIONS.a11y.goToHomePage, 'the stale key follows the repo');
		assert.deepEqual(body.result.overrides, ['common.save']);
	});

	it('serves a legacy file (no overrides list) as stored', async () => {
		const bucket = new MemoryBucket({
			'translations/ar.json': { version: '1.0.81', locale: 'ar', updatedAt: 'x', translations: staleArabic() },
		});
		const { body } = await get(bucket, 'ar');
		assert.equal(body.result.translations.a11y.goToHomePage, 'الصفحة الرئيسية للأمة الآن');
		assert.equal(body.result.overrides, undefined);
	});

	it('answers 304 for the ETag it gave, which names this build\'s static text', async () => {
		const bucket = new MemoryBucket({
			'translations/en.json': { version: '1.0.1', locale: 'en', updatedAt: 'x', translations: {}, overrides: [] },
		});
		const first = await get(bucket, 'en');
		assert.match(first.etag ?? '', /^v\d+-[0-9a-z]+$/);
		const again = await get(bucket, 'en', { 'if-none-match': first.etag! });
		assert.equal(again.status, 304);
		const raw = await get(bucket, 'en', { 'if-none-match': first.etag!.split('-')[0] });
		assert.equal(raw.status, 200, 'the bare R2 etag of an older build no longer matches');
	});
});

describe('POST /api/i18n/sync keeps admin edits (#982)', () => {
	it('refreshes unedited keys from the repo and keeps the edited ones', async () => {
		const stored = staleArabic();
		stored.common.save = 'احفظ الآن';
		const bucket = new MemoryBucket({
			'translations/ar.json': { version: '1.0.82', locale: 'ar', updatedAt: 'x', translations: stored, overrides: ['common.save'] },
		});
		const res = await buildApp(routes, null).request('/api/i18n/sync', { method: 'POST' }, { global_settings: bucket } as any);
		assert.equal(res.status, 200);
		const file = bucket.read('translations/ar.json');
		assert.equal(file.translations.common.save, 'احفظ الآن');
		assert.equal(file.translations.a11y.goToHomePage, AR_TRANSLATIONS.a11y.goToHomePage);
		assert.deepEqual(file.overrides, ['common.save']);
		assert.deepEqual(bucket.read('translations/en.json').overrides, []);
	});
});

describe('override helpers', () => {
	const defaults = { a: { x: 'repo x', y: 'repo y' }, b: { z: 'repo z' } };

	it('applies only the listed keys and never mutates the defaults', () => {
		const out = applyTranslationOverrides(defaults, { a: { x: 'admin x', y: 'stale y' } }, ['a.x', 'b.missing.deep']);
		assert.deepEqual(out, { a: { x: 'admin x', y: 'repo y' }, b: { z: 'repo z' } });
		assert.equal(defaults.a.x, 'repo x');
	});

	it('adds written keys and drops a key saved back to the repo value', () => {
		assert.deepEqual(nextTranslationOverrides(['a.y'], { a: { x: 'admin x' } }, defaults), ['a.x', 'a.y']);
		assert.deepEqual(nextTranslationOverrides(['a.x', 'a.y'], { a: { x: 'repo x' } }, defaults), ['a.y']);
	});

	it('treats every differing key of a legacy file as edited', () => {
		const legacy = { translations: { a: { x: 'repo x', y: 'other' }, c: { extra: 'v' } } };
		assert.deepEqual(differingTranslationPaths(defaults, legacy.translations), ['a.y', 'c.extra']);
		assert.deepEqual(effectiveOverrides(defaults, legacy), ['a.y', 'c.extra']);
		assert.deepEqual(effectiveOverrides(defaults, { ...legacy, overrides: [] }), []);
	});

	it('no translation key contains a dot (paths are dot-joined)', () => {
		const walk = (o: any): string[] => Object.entries(o).flatMap(([k, v]) => [k, ...(v && typeof v === 'object' && !Array.isArray(v) ? walk(v) : [])]);
		for (const tree of [EN_TRANSLATIONS, AR_TRANSLATIONS]) assert.deepEqual(walk(tree).filter((k) => k.includes('.')), []);
	});
});
