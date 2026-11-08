import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APPS } from '../apps.ts';
import { runCheck } from '../check-wrangler-config.ts';
import { checkDeployCommands, scanPackageScripts, scanWorkflow } from '../deploy-commands.ts';
import { parseJsonc } from '../jsonc.ts';
import { applyAccepted, checkApp, type AppRule, type WranglerConfig } from '../wrangler-config.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const rule = (app: string) => APPS.find((a) => a.app === app)!;
const load = (app: string) => parseJsonc(readFileSync(join(ROOT, rule(app).configPath), 'utf8')) as WranglerConfig;
const has = (errors: string[], ...parts: string[]) => errors.some((e) => parts.every((p) => e.includes(p)));

describe('repository config', () => {
	it('passes the check as committed', () => {
		assert.deepEqual(runCheck(ROOT).errors, []);
	});

	it('covers the six deployed apps', () => {
		assert.deepEqual(APPS.map((a) => a.app).sort(), ['admin-api', 'admin-web', 'api-videos', 'processor', 'web', 'websocket-server']);
	});

	it('every app config passes on its own (apart from accepted findings)', () => {
		for (const app of APPS) {
			assert.deepEqual(applyAccepted(app, checkApp(app, load(app.app))).errors, [], app.app);
		}
	});
});

describe('deploy commands', () => {
	const step = (dir: string, command: string) => `
jobs:
  deploy-production:
    steps:
      - name: Deploy
        run: |
          cd ${dir}
          pnpm wrangler deploy${command}
`;

	it('rejects a bare deploy of web (its top-level wrangler.jsonc is the dev config)', () => {
		const errors = checkDeployCommands(scanWorkflow('deploy.yml', step('apps/web', '')), APPS);
		assert.equal(errors.length, 1);
		assert.ok(errors[0].includes('bare deploy for web'));
		assert.ok(errors[0].includes('deploy.yml:8'));
		assert.ok(errors[0].includes('--config wrangler.production.jsonc'));
	});

	it('rejects --env for web and admin-web: they have no env blocks, only config files', () => {
		assert.equal(checkDeployCommands(scanWorkflow('x.yml', step('apps/admin-web', ' --env production')), APPS).length, 1);
	});

	for (const flags of [' --config wrangler.production.jsonc', ' -c wrangler.qa.jsonc', ' --config=wrangler.preview.jsonc', ' --dry-run']) {
		it(`accepts web deploy with${flags}`, () => {
			assert.deepEqual(checkDeployCommands(scanWorkflow('x.yml', step('apps/web', flags)), APPS), []);
		});
	}

	it('sees --config on a continuation line', () => {
		const wf = `
    steps:
      - name: preview
        run: |
          cd apps/admin-web
          pnpm wrangler deploy \\
            --config wrangler.qa.jsonc \\
            --name preview
`;
		assert.deepEqual(checkDeployCommands(scanWorkflow('x.yml', wf), APPS), []);
	});

	it('attributes working-directory steps', () => {
		const wf = `
    steps:
      - name: b
        working-directory: apps/web
        run: pnpm exec wrangler deploy
`;
		assert.equal(checkDeployCommands(scanWorkflow('x.yml', wf), APPS).length, 1);
	});

	it('allows bare deploys for workers whose top level is the prod config', () => {
		for (const app of ['api-videos', 'processor', 'websocket-server', 'admin-api']) {
			assert.deepEqual(checkDeployCommands(scanWorkflow('x.yml', step(`apps/${app}`, '')), APPS), [], app);
		}
	});

	it('checks package scripts', () => {
		const cmds = scanPackageScripts('apps/admin-web/package.json', 'apps/admin-web', {
			scripts: { deploy: 'opennextjs-cloudflare build && wrangler deploy', 'deploy:qa': 'CI=true wrangler deploy --config wrangler.qa.jsonc' },
		});
		const errors = checkDeployCommands(cmds, APPS);
		assert.equal(errors.length, 1);
		assert.ok(errors[0].includes('scripts.deploy'));
	});
});

describe('web production config', () => {
	it('fails when the issuer points anywhere but prod auth', () => {
		const config = load('web');
		(config.vars as Record<string, string>).OPENAUTH_ISSUER = 'https://auth.qa.alummahnow.net';
		const errors = checkApp(rule('web'), config);
		assert.ok(has(errors, 'vars.OPENAUTH_ISSUER must be "https://auth.alummahnow.net"'));
		assert.ok(has(errors, 'non-production value', 'auth.qa.alummahnow.net'));
	});

	it('fails on the dev config (wrangler.jsonc) deployed as production', () => {
		const dev = parseJsonc(readFileSync(join(ROOT, 'apps/web/wrangler.jsonc'), 'utf8')) as WranglerConfig;
		const errors = checkApp(rule('web'), dev);
		assert.ok(has(errors, 'name must be "al-ummah-now-production"'));
		assert.ok(has(errors, 'vars.NEXTJS_ENV must be "production"'));
	});

	it('fails on the admin-web dev config (localhost API URLs)', () => {
		const dev = parseJsonc(readFileSync(join(ROOT, 'apps/admin-web/wrangler.jsonc'), 'utf8')) as WranglerConfig;
		const errors = checkApp(rule('admin-web'), dev);
		assert.ok(has(errors, 'points at localhost'));
		assert.ok(has(errors, 'vars.ADMIN_API_URL must be "https://admin.api.alummahnow.net"'));
	});

	it('fails on a QA route or a test-only var', () => {
		const config = load('web');
		config.routes = [{ pattern: 'videos.qa.alummahnow.net', custom_domain: true }];
		(config.vars as Record<string, string>).E2E_CODE_SINK_SECRET = 'x';
		const errors = checkApp(rule('web'), config);
		assert.ok(has(errors, 'non-production value', 'routes[0].pattern'));
		assert.ok(has(errors, 'test-only var E2E_CODE_SINK_SECRET'));
	});

	it('fails on a route outside alummahnow.net', () => {
		const config = load('web');
		config.routes = ['example.workers.dev/*'];
		assert.ok(has(checkApp(rule('web'), config), 'route example.workers.dev is not an allowed host'));
	});
});

describe('worker production configs', () => {
	it('ignore the local `dev` block (127.0.0.1 there is expected)', () => {
		assert.ok(!has(checkApp(rule('websocket-server'), load('websocket-server')), 'localhost'));
	});

	it('fail when a localhost value reaches a deployed var', () => {
		const config = load('admin-api');
		(config.vars as Record<string, string>).WEBSOCKET_URL = 'http://localhost:3087';
		assert.ok(has(checkApp(rule('admin-api'), config), 'vars.WEBSOCKET_URL points at localhost'));
	});

	it('fail when a required Secrets Store binding is dropped', () => {
		const config = load('api-videos');
		config.secrets_store_secrets = (config.secrets_store_secrets as { binding: string }[]).filter((s) => s.binding !== 'INTERNAL_API_KEY');
		assert.ok(has(checkApp(rule('api-videos'), config), 'missing required secrets_store_secrets binding INTERNAL_API_KEY'));
	});

	it('fail on a placeholder D1 id, including all-zero stand-ins', () => {
		const config = load('admin-api');
		(config.d1_databases as { database_id: string }[])[0].database_id = '00000000-0000-0000-0000-000000000001';
		assert.ok(has(checkApp(rule('admin-api'), config), 'd1_databases[0].database_id is an unfilled placeholder'));
	});

	it('only look at the deployed env, not env.development', () => {
		const errors = checkApp(rule('admin-api'), load('admin-api'));
		assert.deepEqual(errors, []);
	});
});

describe('accepted findings', () => {
	const app: AppRule = {
		app: 'demo',
		configPath: 'x',
		dir: 'apps/demo',
		deployFlags: 'any',
		production: { env: null, allowedHosts: [] },
		accepted: [{ match: 'known problem', issue: '#1' }],
	};

	it('keep a tracked problem from failing the check', () => {
		const result = applyAccepted(app, ['demo: known problem', 'demo: new problem']);
		assert.deepEqual(result.errors, ['demo: new problem']);
		assert.deepEqual(result.accepted, ['demo: known problem [accepted, #1]']);
	});

	it('fail once the problem is fixed, so the entry gets removed', () => {
		const result = applyAccepted(app, []);
		assert.equal(result.errors.length, 1);
		assert.ok(result.errors[0].includes('no longer occurs'));
	});
});

describe('parseJsonc', () => {
	it('handles comments, trailing commas and slashes inside strings', () => {
		const text = `{
  // comment
  "url": "https://example.com/a", /* block */
  "list": [1, 2,],
}`;
		assert.deepEqual(parseJsonc(text), { url: 'https://example.com/a', list: [1, 2] });
	});
});
