import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncTranslationsEndpoint } from '../src/endpoints/i18n/translationsSync';
// The web app's static translations: what users see when the store is empty.
// The seed must match them exactly, or the stored copy (which the web merges
// over its static text) silently changes the UI.
import { EN_TRANSLATIONS as WEB_EN } from '../../web/src/lib/i18n/translations/en';
import { AR_TRANSLATIONS as WEB_AR } from '../../web/src/lib/i18n/translations/ar';
import { MemoryBucket, buildApp } from './helpers';

function leafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
	return Object.entries(obj).flatMap(([k, v]) =>
		v && typeof v === 'object' ? leafKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
	);
}

function routes(r: any) {
	r.post('/api/i18n/sync', SyncTranslationsEndpoint);
}

async function sync(bucket: MemoryBucket) {
	const app = buildApp(routes, null);
	const res = await app.request('/api/i18n/sync', { method: 'POST' }, { global_settings: bucket } as any);
	return { status: res.status, body: (await res.json()) as any };
}

describe('POST /api/i18n/sync', () => {
	it('seeds exactly the web static translations', async () => {
		const bucket = new MemoryBucket();
		const { status } = await sync(bucket);
		assert.equal(status, 200);
		assert.deepEqual(bucket.read('translations/en.json').translations, WEB_EN);
		assert.deepEqual(bucket.read('translations/ar.json').translations, WEB_AR);
		assert.deepEqual(bucket.read('translations/metadata.json').sections, Object.keys(WEB_EN));
	});

	it('starts an empty store at version 1.0.0', async () => {
		const bucket = new MemoryBucket();
		const { body } = await sync(bucket);
		assert.equal(body.result.version, '1.0.0');
		assert.equal(bucket.read('translations/en.json').version, '1.0.0');
	});

	it('bumps the stored version instead of resetting it, so web caches refresh', async () => {
		const bucket = new MemoryBucket({
			'translations/en.json': { version: '1.0.78', locale: 'en', translations: {} },
			'translations/ar.json': { version: '1.0.77', locale: 'ar', translations: {} },
			'translations/metadata.json': { version: '1.0.78', locales: ['en', 'ar'], checksums: {} },
		});
		const { body } = await sync(bucket);
		assert.equal(body.result.version, '1.0.79');
		assert.equal(bucket.read('translations/en.json').version, '1.0.79');
		assert.equal(bucket.read('translations/ar.json').version, '1.0.79');
		assert.equal(bucket.read('translations/metadata.json').version, '1.0.79');
		assert.equal(bucket.read('config/i18n-config.json').version, '1.0.79');
	});

	it('seeds an Arabic string for every English key', () => {
		const ar = new Set(leafKeys(WEB_AR as unknown as Record<string, unknown>));
		const missing = leafKeys(WEB_EN as unknown as Record<string, unknown>).filter((k) => !ar.has(k));
		assert.deepEqual(missing, []);
	});
});
