import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPreviewConfig, previewProblems, previewUrl, productionIdentifiers, readQaConfig, type PreviewApp } from '../preview-config.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const options = { pr: 498, subdomain: 'acct' };

describe('real preview configs', () => {
	for (const app of ['web', 'api-videos'] as PreviewApp[]) {
		it(`${app} has no production binding or host`, () => {
			const config = buildPreviewConfig(app, readQaConfig(app), options);
			assert.deepEqual(previewProblems(config, productionIdentifiers()), []);
		});
	}

	it('finds the production identifiers', () => {
		const ids = productionIdentifiers();
		assert.ok(ids.has('videos'), 'production videos bucket');
		assert.ok(ids.has('al-ummah-now-search'), 'production search database');
	});
});

describe('buildPreviewConfig', () => {
	const web = buildPreviewConfig('web', { name: 'al-ummah-web-qa', routes: [{ pattern: 'x' }], vars: { API_URL: 'qa', Issuer: 'q' } }, options);
	const api = buildPreviewConfig('api-videos', { name: 'videos-qa', triggers: { crons: ['1 1 * * *'] }, queues: { producers: [{ queue: 'q-qa' }], consumers: [{ queue: 'q-qa' }] }, vars: { CORS_ORIGINS: 'https://videos.qa.alummahnow.net' } }, options);

	it('names the Workers by PR', () => {
		assert.equal(web.name, 'al-ummah-web-pr-498');
		assert.equal(api.name, 'al-ummah-api-pr-498');
	});

	it('uses the full workers.dev URL', () => {
		assert.equal(previewUrl('web', options), 'https://al-ummah-web-pr-498.acct.workers.dev');
	});

	it('takes over no route, cron or queue consumer', () => {
		assert.equal(web.routes, undefined);
		assert.equal(api.triggers, undefined);
		assert.deepEqual((api.queues as { consumers: unknown[] }).consumers, []);
		assert.deepEqual((api.queues as { producers: unknown[] }).producers, [{ queue: 'q-qa' }]);
		assert.equal(web.workers_dev, true);
	});

	it('points the web preview at the API preview', () => {
		assert.equal((web.vars as Record<string, string>).API_URL, 'https://al-ummah-api-pr-498.acct.workers.dev');
	});

	it('lets the web preview call the API preview', () => {
		assert.match((api.vars as Record<string, string>).CORS_ORIGINS, /https:\/\/al-ummah-web-pr-498\.acct\.workers\.dev/);
		assert.match((api.vars as Record<string, string>).CORS_ORIGINS, /videos\.qa\.alummahnow\.net/);
	});
});

describe('previewProblems', () => {
	const ids = new Set(['videos', 'prod-db-id', 'al-ummah-now-videos']);
	const safe = { name: 'al-ummah-web-pr-1', vars: { Issuer: 'https://auth.qa.alummahnow.net' }, r2_buckets: [{ binding: 'videos', bucket_name: 'videos-qa' }] };

	it('accepts a QA-only config', () => assert.deepEqual(previewProblems(safe, ids), []));

	it('refuses a production bucket, even when the binding is the same name', () => {
		assert.equal(previewProblems({ ...safe, r2_buckets: [{ binding: 'videos', bucket_name: 'videos' }] }, ids).length, 1);
	});

	it('refuses a production database and queue', () => {
		assert.equal(previewProblems({ ...safe, d1_databases: [{ binding: 'X', database_id: 'prod-db-id' }] }, ids).length, 1);
		assert.equal(previewProblems({ ...safe, queues: { producers: [{ queue: 'al-ummah-now-videos' }] } }, ids).length, 1);
	});

	it('refuses a production host', () => {
		for (const host of ['https://auth.alummahnow.net', 'https://videos.api.alummahnow.net/x', 'wss://realtime.alummahnow.net/ws']) {
			assert.equal(previewProblems({ ...safe, vars: { X: host } }, ids).length, 1, host);
		}
	});

	it('refuses a Worker not named as a preview', () => {
		assert.equal(previewProblems({ ...safe, name: 'videos-qa' }, ids).length, 1);
	});

	it('refuses a route', () => {
		assert.equal(previewProblems({ ...safe, routes: [{ pattern: 'a.qa.alummahnow.net/*' }] }, ids).length, 1);
	});
});

describe('the workflow', () => {
	const workflow = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
	const section = workflow.slice(workflow.indexOf('  pr-preview:'), workflow.indexOf('  deploy-qa:'));

	it('deploys previews only from the generated, checked config', () => {
		const deploys = section.split('\n').filter((line) => /wrangler deploy/.test(line));
		assert.equal(deploys.length, 2);
		for (const line of deploys) assert.match(line, /--config wrangler\.pr-preview\.json/);
		assert.match(section, /preview-config\.ts/);
	});

	it('runs the specs with the release config, which defines the browser projects', () => {
		assert.match(section, /playwright test -c playwright\.release\.config\.ts studio-/);
	});

	it('runs no preview of the other Workers', () => {
		for (const job of ['deploy-processor-preview', 'deploy-websocket-preview', 'deploy-admin-api-preview', 'deploy-admin-web-preview', 'deploy-api-preview', 'deploy-web-preview']) {
			assert.ok(!workflow.includes(`  ${job}:`), job);
		}
	});

	it('removes both previews when the PR closes', () => {
		const cleanup = readFileSync(join(ROOT, '.github/workflows/cleanup-pr-previews.yml'), 'utf8');
		assert.match(cleanup, /pull_request:\s+types: \[closed\]/);
		assert.match(cleanup, /WEB_NAME="al-ummah-web-pr-/);
		assert.match(cleanup, /al-ummah-api-pr-/);
		assert.match(cleanup, /wrangler delete[^\n]*--force/);
	});

	it('leaves no production-bound preview config behind', () => {
		assert.equal(existsSync(join(ROOT, 'apps/web/wrangler.preview.jsonc')), false);
	});
});
