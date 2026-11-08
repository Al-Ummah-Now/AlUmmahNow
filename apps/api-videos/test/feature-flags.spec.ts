import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers';
import { AppConfigGet } from '../src/endpoints/app-config/appConfigGet';
import { AppConfigDocumentGet, AppConfigDocumentPut } from '../src/endpoints/app-config/appConfigAdmin';
import { readAppConfigDocument } from '../src/lib/app-config-store';
import {
	ConfigRulesDocumentSchema,
	RulesDocumentSchema,
	evaluateConfig,
	evaluateFlags,
	loadRules,
	rolloutBucket,
	ruleMatches,
} from '../src/lib/feature-flags';
import type { FlagContext, FlagRule } from '../src/lib/feature-flags';

/**
 * Remote config & feature flags (Epic 9.5): rule evaluation truth table,
 * deterministic rollout, invalid documents rejected (never written), missing
 * KV falls back to defaults, per-isolate cache.
 */

class MemoryKV {
	gets = 0;
	constructor(public values: Record<string, unknown> = {}) {}
	async get(key: string) {
		this.gets++;
		return this.values[key] ?? null;
	}
	async put(key: string, value: string) {
		this.values[key] = JSON.parse(value);
	}
}

const ctx: FlagContext = { platform: 'ios', app: 'viewer', version: '1.4.0', locale: 'ar-EG', installId: 'install-0001' };
const rule = (r: Partial<FlagRule> & { key: string }): FlagRule => RulesDocumentSchema.parse([r])[0];

describe('ruleMatches', () => {
	const cases: Array<[string, Partial<FlagRule>, Partial<FlagContext>, boolean]> = [
		['no conditions', {}, {}, true],
		['platform listed', { platforms: ['ios', 'android'] }, {}, true],
		['platform not listed', { platforms: ['android'] }, {}, false],
		['app listed', { apps: ['viewer'] }, {}, true],
		['app not listed', { apps: ['studio'] }, {}, false],
		['at minVersion', { minVersion: '1.4.0' }, {}, true],
		['below minVersion', { minVersion: '1.4.1' }, {}, false],
		['at maxVersion', { maxVersion: '1.4.0' }, {}, true],
		['above maxVersion', { maxVersion: '1.3.9' }, {}, false],
		['pre-release counts as its version', { minVersion: '1.4.0' }, { version: '1.4.0-beta.1' }, true],
		['locale prefix', { locales: ['ar'] }, {}, true],
		['exact locale', { locales: ['ar-EG'] }, {}, true],
		['other locale', { locales: ['en'] }, {}, false],
		['prefix is per subtag', { locales: ['ar'] }, { locale: 'arz' }, false],
		['locale rule, no locale', { locales: ['ar'] }, { locale: undefined }, false],
		['rollout 100 without install id', { rollout: 100 }, { installId: undefined }, true],
		['rollout 0', { rollout: 0 }, {}, false],
		['partial rollout without install id', { rollout: 50 }, { installId: undefined }, false],
	];
	for (const [name, r, c, expected] of cases) {
		it(name, () => assert.equal(ruleMatches(rule({ key: 'f', ...r }), { ...ctx, ...c }), expected));
	}
});

describe('rollout', () => {
	it('is stable per install and key, and close to the percentage', () => {
		assert.equal(rolloutBucket('f', 'abc'), rolloutBucket('f', 'abc'));
		let inside = 0;
		for (let i = 0; i < 2000; i++) if (ruleMatches(rule({ key: 'new_player', rollout: 25 }), { ...ctx, installId: `install-${i}` })) inside++;
		assert.ok(inside > 400 && inside < 600, `${inside} of 2000 in a 25% rollout`);
	});

	it('raising the percentage keeps everyone already inside', () => {
		for (let i = 0; i < 500; i++) {
			const c = { ...ctx, installId: `i-${i}` };
			if (ruleMatches(rule({ key: 'f', rollout: 10 }), c)) assert.ok(ruleMatches(rule({ key: 'f', rollout: 30 }), c));
		}
	});
});

describe('evaluateFlags / evaluateConfig', () => {
	it('first matching rule of a key wins; unmatched flags are false', () => {
		const rules = RulesDocumentSchema.parse([
			{ key: 'downloads', enabled: false, platforms: ['tvos'] },
			{ key: 'downloads', enabled: true },
			{ key: 'shorts_tab', enabled: true, minVersion: '2.0.0' },
			{ key: 'player', value: 'v2', apps: ['viewer'] },
		]);
		assert.deepEqual(evaluateFlags(rules, ctx), { downloads: true, shorts_tab: false, player: 'v2' });
		assert.deepEqual(evaluateFlags(rules, { ...ctx, platform: 'tvos' }), { downloads: false, shorts_tab: false, player: 'v2' });
	});

	it('config takes the first matching value and leaves unmatched keys out', () => {
		const rules = ConfigRulesDocumentSchema.parse([
			{ key: 'home.rows', value: ['continue', 'shorts'], locales: ['ar'] },
			{ key: 'home.rows', value: ['continue'] },
			{ key: 'support.email', value: 'help@example.org', platforms: ['android'] },
		]);
		assert.deepEqual(evaluateConfig(rules, ctx), { 'home.rows': ['continue', 'shorts'] });
		assert.deepEqual(evaluateConfig(rules, { ...ctx, locale: 'en' }), { 'home.rows': ['continue'] });
	});
});

describe('documents', () => {
	it('rejects bad rules', () => {
		for (const bad of [
			[{ key: 'Bad Key' }],
			[{ key: 'f', platforms: ['playstation'] }],
			[{ key: 'f', rollout: 120 }],
			[{ key: 'f', minVersion: '2.0.0', maxVersion: '1.0.0' }],
			[{ key: 'f', surprise: true }],
			{ key: 'f' },
		]) {
			assert.equal(RulesDocumentSchema.safeParse(bad).success, false, JSON.stringify(bad));
		}
		assert.equal(ConfigRulesDocumentSchema.safeParse([{ key: 'c' }]).success, false, 'config rules need a value');
	});

	it('a missing namespace or document gives no rules; an invalid one gives no rules and the error', async () => {
		assert.deepEqual(await loadRules(undefined, 'flags'), { rules: [] });
		assert.deepEqual(await loadRules(new MemoryKV() as never, 'flags'), { rules: [] });
		const bad = await loadRules(new MemoryKV({ flags: [{ key: 'X' }] }) as never, 'flags');
		assert.deepEqual(bad.rules, []);
		assert.ok(bad.error);
	});

	it('reads are cached per isolate for 60 s', async () => {
		const kv = new MemoryKV({ flags: [] });
		await readAppConfigDocument(kv as never, 'flags', 1_000);
		await readAppConfigDocument(kv as never, 'flags', 30_000);
		assert.equal(kv.gets, 1);
		await readAppConfigDocument(kv as never, 'flags', 62_000);
		assert.equal(kv.gets, 2);
	});
});

describe('GET /api/app-config with flags', () => {
	it('returns the evaluated flags and config for the build', async () => {
		const kv = new MemoryKV({
			flags: [{ key: 'downloads', platforms: ['ios'] }, { key: 'casting', minVersion: '9.0.0' }],
			config: [{ key: 'home.rows', value: ['continue'] }],
		});
		const app = buildApp((r) => r.get('/api/app-config', AppConfigGet));
		const res = await app.request('/api/app-config?platform=ios&app=viewer&version=1.0.0&installId=abcdefgh12', {}, { APP_CONFIG: kv });
		assert.equal(res.status, 200);
		const body: any = await res.json();
		assert.deepEqual(body.flags, { downloads: true, casting: false });
		assert.deepEqual(body.config, { 'home.rows': ['continue'] });
	});

	it('an invalid flags document never breaks start-up', async () => {
		const kv = new MemoryKV({ flags: 'nonsense' });
		const app = buildApp((r) => r.get('/api/app-config', AppConfigGet));
		const res = await app.request('/api/app-config?platform=ios&app=viewer&version=1.0.0', {}, { APP_CONFIG: kv });
		assert.equal(res.status, 200);
		assert.deepEqual(((await res.json()) as any).flags, {});
	});
});

describe('/internal/app-config/:key', () => {
	const json = { 'Content-Type': 'application/json' };
	const admin = () =>
		buildApp((r) => {
			r.get('/internal/app-config/:key', AppConfigDocumentGet);
			r.put('/internal/app-config/:key', AppConfigDocumentPut);
		});

	it('validates before writing: a bad document is rejected and nothing changes', async () => {
		const kv = new MemoryKV({ flags: [{ key: 'keep' }] });
		const res = await admin().request('/internal/app-config/flags', { method: 'PUT', headers: json, body: JSON.stringify([{ key: 'BAD' }]) }, { APP_CONFIG: kv });
		assert.equal(res.status, 400);
		assert.equal(((await res.json()) as any).error, 'invalid_document');
		assert.deepEqual(kv.values.flags, [{ key: 'keep' }]);
	});

	it('stores a valid document and the next app-config read sees it', async () => {
		const kv = new MemoryKV();
		const app = admin();
		const doc = [{ key: 'downloads', enabled: true }];
		const put = await app.request('/internal/app-config/flags', { method: 'PUT', headers: json, body: JSON.stringify(doc) }, { APP_CONFIG: kv });
		assert.equal(put.status, 200);
		const got: any = await (await app.request('/internal/app-config/flags', {}, { APP_CONFIG: kv })).json();
		assert.deepEqual(got.value, [{ key: 'downloads', enabled: true }]);
		const versions = await app.request('/internal/app-config/versions', { method: 'PUT', headers: json, body: JSON.stringify({ 'viewer/ios': { minimumVersion: '1.0.0' } }) }, { APP_CONFIG: kv });
		assert.equal(versions.status, 200);
	});

	it('only known keys', async () => {
		const res = await admin().request('/internal/app-config/secrets', { method: 'PUT', headers: json, body: '[]' }, { APP_CONFIG: new MemoryKV() });
		assert.equal(res.status, 400);
	});

	it('503 when the namespace is not bound', async () => {
		const res = await admin().request('/internal/app-config/flags', {}, {});
		assert.equal(res.status, 503);
	});
});
