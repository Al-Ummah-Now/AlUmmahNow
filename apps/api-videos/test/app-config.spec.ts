/** Epic 9.3: /api/v1/app-config minimum-version check. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers';
import { AppConfigGet } from '../src/endpoints/app-config/appConfigGet';
import { compareVersions, loadVersionsDocument, policyFor, updateStatus } from '../src/lib/app-config';

class MemoryKV {
	constructor(private values: Record<string, unknown>) {}
	async get(key: string) {
		return this.values[key] ?? null;
	}
}

function app() {
	return buildApp((r) => r.get('/api/app-config', AppConfigGet));
}
async function call(query: string, env: Record<string, unknown> = {}) {
	return app().fetch(new Request(`http://x/api/app-config?${query}`), env as never);
}

describe('compareVersions / updateStatus', () => {
	it('compares numerically, ignoring pre-release suffixes', () => {
		assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
		assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
		assert.equal(compareVersions('0.9.0', '1.0.0'), -1);
		assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), 0);
		assert.throws(() => compareVersions('1.2', '1.0.0'));
	});
	it('required below the minimum, recommended below the latest', () => {
		const p = { minimumVersion: '1.2.0', latestVersion: '1.5.0' };
		assert.equal(updateStatus('1.1.9', p), 'required');
		assert.equal(updateStatus('1.2.0', p), 'recommended');
		assert.equal(updateStatus('1.5.0', p), 'ok');
		assert.equal(updateStatus('2.0.0', { minimumVersion: '1.0.0' }), 'ok');
	});
	it('falls back from app/platform to app/* to the default', () => {
		const doc = { 'viewer/ios': { minimumVersion: '2.0.0' }, 'viewer/*': { minimumVersion: '1.0.0' } };
		assert.equal(policyFor(doc, 'viewer', 'ios').minimumVersion, '2.0.0');
		assert.equal(policyFor(doc, 'viewer', 'android').minimumVersion, '1.0.0');
		assert.equal(policyFor(doc, 'studio', 'ios').minimumVersion, '0.0.0');
	});
});

describe('GET /api/app-config', () => {
	it('never blocks without configuration', async () => {
		const res = await call('platform=android&app=viewer&version=0.1.0');
		assert.equal(res.status, 200);
		const body: any = await res.json();
		assert.deepEqual(body.api, { current: '1', supported: ['1'] });
		assert.deepEqual(body.update, { status: 'ok', minimumVersion: '0.0.0', latestVersion: null, storeUrl: null });
		assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
	});

	it('requires an update below the configured minimum', async () => {
		const kv = new MemoryKV({ versions: { 'viewer/ios': { minimumVersion: '1.3.0', latestVersion: '1.4.0', storeUrl: 'https://apps.apple.com/app/id1' } } });
		const body: any = await (await call('platform=ios&app=viewer&version=1.2.9', { APP_CONFIG: kv })).json();
		assert.equal(body.update.status, 'required');
		assert.equal(body.update.storeUrl, 'https://apps.apple.com/app/id1');
	});

	it('ignores an invalid versions document', async () => {
		const kv = new MemoryKV({ versions: { 'viewer/ios': { minimumVersion: 'nine', storeUrl: 'javascript:alert(1)' } } });
		assert.equal((await loadVersionsDocument(kv as never)).doc, undefined);
		const body: any = await (await call('platform=ios&app=viewer&version=1.0.0', { APP_CONFIG: kv })).json();
		assert.equal(body.update.status, 'ok');
	});

	it('rejects unknown platforms, apps and malformed versions', async () => {
		for (const q of ['platform=symbian&app=viewer&version=1.0.0', 'platform=ios&app=other&version=1.0.0', 'platform=ios&app=viewer&version=1.0', 'platform=ios&app=viewer']) {
			assert.equal((await call(q)).status, 400, q);
		}
	});
});
