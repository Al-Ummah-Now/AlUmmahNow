import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CfApiError, type CfClient } from '../cf-api.ts';
import { computeMapping, mappingVarArgs, nextMapping, readDeploymentId, retainedVersions, RETENTION } from '../skew-mapping.ts';
import { checkSkewConfig } from '../skew-config.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-11-09T12:00:00Z');

describe('retainedVersions', () => {
	it('keeps the newest code uploads within the age window, up to the limit', () => {
		const versions = [
			{ id: 'old', createdOnMs: NOW - 8 * DAY, triggeredBy: 'version_upload' },
			{ id: 'secret', createdOnMs: NOW - 1 * DAY, triggeredBy: 'secret' },
			{ id: 'a', createdOnMs: NOW - 2 * DAY, triggeredBy: 'version_upload' },
			{ id: 'b', createdOnMs: NOW - 1 * DAY, triggeredBy: 'upload' },
			{ id: 'legacy', createdOnMs: NOW - 3 * DAY },
		];
		assert.deepEqual([...retainedVersions(versions, NOW)], ['b', 'a', 'legacy']);
		assert.deepEqual([...retainedVersions(versions, NOW, { maxNumberOfVersions: 1, maxVersionAgeDays: 7 })], ['b']);
	});
});

describe('nextMapping', () => {
	it('makes the new build current and pins the serving build to its version', () => {
		const mapping = nextMapping({ existing: { b2: 'current', b1: 'v1' }, serving: 'v2', retained: new Set(['v1', 'v2']), deploymentId: 'b3' });
		assert.deepEqual(mapping, { b3: 'current', b2: 'v2', b1: 'v1' });
	});

	it('drops builds whose versions left the retention window, but never the serving one', () => {
		const mapping = nextMapping({ existing: { b2: 'current', b1: 'v1' }, serving: 'v2', retained: new Set(), deploymentId: 'b3' });
		assert.deepEqual(mapping, { b3: 'current', b2: 'v2' });
	});

	it('the same build uploaded again (a re-run) stays current', () => {
		const mapping = nextMapping({ existing: { b3: 'current', b1: 'v1' }, serving: 'v3', retained: new Set(['v1']), deploymentId: 'b3' });
		assert.deepEqual(mapping, { b3: 'current', b1: 'v1' });
	});

	it('wrangler arg', () => {
		assert.deepEqual(mappingVarArgs({ b: 'current' }), ['--var', 'CF_DEPLOYMENT_MAPPING:{"b":"current"}']);
	});
});

function fakeCf(routes: Record<string, unknown>): CfClient & { paths: string[] } {
	const paths: string[] = [];
	return {
		accountId: 'acc',
		paths,
		async request<T>(_m: string, path: string): Promise<T> {
			paths.push(path);
			const key = Object.keys(routes).find((k) => path.startsWith(k));
			if (!key) throw new CfApiError(404, `GET ${path} -> 404`);
			return routes[key] as T;
		},
	};
}

describe('computeMapping', () => {
	it('reads the serving version mapping (not the newest upload) and the version list', async () => {
		const cf = fakeCf({
			'/workers/scripts/w/deployments': { deployments: [{ versions: [{ version_id: 'v2', percentage: 100 }] }] },
			'/workers/scripts/w/versions/v2': { resources: { bindings: [{ name: 'CF_DEPLOYMENT_MAPPING', type: 'plain_text', text: '{"b2":"current","b1":"v1","b0":"v0"}' }] } },
			'/workers/scripts/w/versions?': {
				items: [
					{ id: 'rolled-back', metadata: { created_on: new Date(NOW - 1000).toISOString() } },
					{ id: 'v2', metadata: { created_on: new Date(NOW - DAY).toISOString() } },
					{ id: 'v1', metadata: { created_on: new Date(NOW - 2 * DAY).toISOString() } },
					{ id: 'v0', metadata: { created_on: new Date(NOW - 30 * DAY).toISOString() } },
				],
			},
		});
		assert.deepEqual(await computeMapping(cf, 'w', 'b3', undefined, NOW), { b3: 'current', b2: 'v2', b1: 'v1' });
	});

	it('uses the serving version it is given and starts fresh for a new worker', async () => {
		const cf = fakeCf({});
		assert.deepEqual(await computeMapping(cf, 'w', 'b1', undefined, NOW), { b1: 'current' });
		assert.deepEqual(await computeMapping(cf, 'w', 'b1', null, NOW), { b1: 'current' });
	});
});

describe('readDeploymentId', () => {
	it('reads the id the OpenNext build baked into init.js, and refuses a build without one', () => {
		const dir = mkdtempSync(join(tmpdir(), 'skew-'));
		mkdirSync(join(dir, 'cloudflare'));
		writeFileSync(join(dir, 'cloudflare/init.js'), 'if ("abc-1-1") {\n    process.env.DEPLOYMENT_ID = "abc-1-1";\n  }\n');
		assert.equal(readDeploymentId(dir), 'abc-1-1');
		writeFileSync(join(dir, 'cloudflare/init.js'), 'if ("") {\n    process.env.DEPLOYMENT_ID = "";\n  }\n');
		assert.throws(() => readDeploymentId(dir), /NEXT_DEPLOYMENT_ID/);
	});
});

describe('skew config check', () => {
	it('passes as committed', () => {
		assert.deepEqual(checkSkewConfig(ROOT), []);
	});

	it('catches a config that would break skew protection', () => {
		const copy = mkdtempSync(join(tmpdir(), 'skewcfg-'));
		for (const dir of ['apps/web', 'apps/admin-web']) {
			mkdirSync(join(copy, dir), { recursive: true });
			for (const f of ['open-next.config.ts', 'worker.ts', 'wrangler.jsonc', 'wrangler.qa.jsonc', 'wrangler.production.jsonc']) {
				cpSync(join(ROOT, dir, f), join(copy, dir, f));
			}
		}
		const qa = join(copy, 'apps/web/wrangler.qa.jsonc');
		writeFileSync(qa, readFileSync(qa, 'utf8').replace('"preview_urls": true,', '').replace('"CF_WORKER_NAME": "al-ummah-web-qa"', '"CF_WORKER_NAME": "al-ummah-now-production"'));
		const dev = join(copy, 'apps/admin-web/wrangler.jsonc');
		writeFileSync(dev, readFileSync(dev, 'utf8').replace('"run_worker_first": ["/_next/static/*"]', '"run_worker_first": true'));
		const onc = join(copy, 'apps/admin-web/open-next.config.ts');
		writeFileSync(onc, readFileSync(onc, 'utf8').replace(`maxVersionAgeDays: ${RETENTION.maxVersionAgeDays}`, 'maxVersionAgeDays: 1'));
		const errors = checkSkewConfig(copy);
		assert.ok(errors.some((e) => e.includes('wrangler.qa.jsonc') && e.includes('preview_urls')), errors.join('\n'));
		assert.ok(errors.some((e) => e.includes('wrangler.qa.jsonc') && e.includes('CF_WORKER_NAME')));
		assert.ok(errors.some((e) => e.includes('admin-web/wrangler.jsonc') && e.includes('run_worker_first')));
		assert.ok(errors.some((e) => e.includes('admin-web/open-next.config.ts') && e.includes('SKEW_RETENTION')));
	});
});

describe('build secrets', () => {
	it('every build secret in the manifest is read by its workflow build step, and guarded', async () => {
		const { BUILD_SECRETS } = await import('../secrets-manifest.ts');
		for (const s of BUILD_SECRETS) {
			const wf = readFileSync(join(ROOT, '.github/workflows', s.workflow), 'utf8');
			assert.ok(wf.includes(`secrets.${s.name}`), `${s.workflow} does not read ${s.name}`);
			assert.ok(wf.includes(`${s.name} is not set`), `${s.workflow} does not fail when ${s.name} is missing`);
			assert.ok(wf.includes('NEXT_DEPLOYMENT_ID='), `${s.workflow} does not set a deployment id per build`);
		}
	});
});
