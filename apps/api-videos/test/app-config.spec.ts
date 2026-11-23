/** Epic 9.3: /api/v1/app-config minimum-version check. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers';
import { AppConfigGet } from '../src/endpoints/app-config/appConfigGet';
import { writeFeatureSwitch } from '@al-ummah/shared-types';
import { compareVersions, loadVersionsDocument, policyFor, updateStatus } from '../src/lib/app-config';
import { forgetFeatureSwitches } from '../src/lib/features/switches';
import { SqliteD1 } from './search-sqlite-d1';

class MemoryKV {
	constructor(private values: Record<string, unknown>) {}
	async get(key: string) {
		return this.values[key] ?? null;
	}
}

/** A search D1 with the appUpdates switch on (AUN-APP-UPDATES; it defaults off) */
async function switchedOn(): Promise<D1Database> {
	const d1 = new SqliteD1() as unknown as D1Database;
	await writeFeatureSwitch({ SEARCH_DB: d1 } as never, { key: 'appUpdates', enabled: true, expectedVersion: 0, actorId: 'usr_admin1', currentStored: false });
	forgetFeatureSwitches();
	return d1;
}

function app() {
	return buildApp((r) => r.get('/api/app-config', AppConfigGet));
}
async function call(query: string, env: Record<string, unknown> = {}) {
	return app().fetch(new Request(`http://x/api/app-config?${query}`), env as never);
}

describe('compareVersions / updateStatus', () => {
	it('compares numerically; a pre-release is below its release (AUN-APP-UPDATES §2.1)', () => {
		assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
		assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
		assert.equal(compareVersions('0.9.0', '1.0.0'), -1);
		assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), -1);
		assert.equal(compareVersions('1.2.0+build.1', '1.2.0'), 0);
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
	it('never blocks without configuration, and shows nothing while the switch is off', async () => {
		const res = await call('platform=android&app=viewer&version=0.1.0');
		assert.equal(res.status, 200);
		const body: any = await res.json();
		assert.deepEqual(body.api, { current: '1', supported: ['1'] });
		assert.equal(body.update.enabled, false);
		assert.equal(body.update.status, 'ok');
		assert.equal(body.update.minimumVersion, '0.0.0');
		assert.equal(body.update.action, 'none');
		assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
	});

	it('switch off: a build below the minimum is not held (AUN-APP-UPDATES)', async () => {
		forgetFeatureSwitches();
		const kv = new MemoryKV({ versions: { 'viewer/ios': { minimumVersion: '1.3.0', latestVersion: '1.4.0' } } });
		const body: any = await (await call('platform=ios&app=viewer&version=1.2.9', { APP_CONFIG: kv })).json();
		assert.equal(body.update.status, 'ok');
		assert.equal(body.update.enabled, false);
	});

	it('switch on: requires an update below the configured minimum', async () => {
		const kv = new MemoryKV({ versions: { 'viewer/ios': { minimumVersion: '1.3.0', latestVersion: '1.4.0', storeUrl: 'https://apps.apple.com/app/id1', message: { en: 'Sign-in changed.', ar: 'تغيّر تسجيل الدخول.' } } } });
		const body: any = await (await call('platform=ios&app=viewer&version=1.2.9', { APP_CONFIG: kv, SEARCH_DB: await switchedOn() })).json();
		assert.equal(body.update.enabled, true);
		assert.equal(body.update.status, 'required');
		assert.equal(body.update.storeUrl, 'https://apps.apple.com/app/id1');
		assert.deepEqual(body.update.message, { en: 'Sign-in changed.', ar: 'تغيّر تسجيل الدخول.' });
		forgetFeatureSwitches();
	});

	it('a beta policy overrides the platform policy for beta builds', () => {
		const doc = { 'viewer/ios': { minimumVersion: '1.0.0' }, 'viewer/ios#beta': { minimumVersion: '1.5.0' } };
		assert.equal(policyFor(doc, 'viewer', 'ios', 'beta').minimumVersion, '1.5.0');
		assert.equal(policyFor(doc, 'viewer', 'ios', 'stable').minimumVersion, '1.0.0');
	});

	it('accepts 4-part versions, channel, source and arch; refuses unknown ones', async () => {
		assert.equal((await call('platform=windows&app=tools&version=2026.11.22.2&channel=stable&source=direct&arch=x64')).status, 200);
		assert.equal((await call('platform=ios&app=viewer&version=1.2.3.2&source=testflight&channel=beta')).status, 200);
		assert.equal((await call('platform=ios&app=viewer&version=1.2.3&source=sideload')).status, 400);
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
