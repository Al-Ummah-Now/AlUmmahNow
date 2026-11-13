import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APPS } from '../apps.ts';
import { runCheck } from '../check-wrangler-config.ts';
import { checkDeployCommands, scanPackageScripts, scanWorkflow } from '../deploy-commands.ts';
import { parseJsonc } from '../jsonc.ts';
import { applyAccepted, checkApp, checkLogPolicy, resolveEnv, type AppRule, type WranglerConfig } from '../wrangler-config.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const rule = (app: string) => APPS.find((a) => a.app === app)!;
const load = (app: string) => parseJsonc(readFileSync(join(ROOT, rule(app).configPath), 'utf8')) as WranglerConfig;
const has = (errors: string[], ...parts: string[]) => errors.some((e) => parts.every((p) => e.includes(p)));

describe('repository config', () => {
	it('passes the check as committed', () => {
		assert.deepEqual(runCheck(ROOT).errors, []);
	});

	it('covers the ten deployed apps', () => {
		assert.deepEqual(APPS.map((a) => a.app).sort(), ['admin-api', 'admin-web', 'api-videos', 'cost-monitor', 'media', 'processor', 'scheduler', 'short-links', 'web', 'websocket-server']);
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

	it('rejects --env without --config for web and admin-web: their top-level wrangler.jsonc is the dev config', () => {
		assert.equal(checkDeployCommands(scanWorkflow('x.yml', step('apps/admin-web', ' --env production')), APPS).length, 1);
	});

	for (const flags of [' --config wrangler.production.jsonc', ' --config wrangler.production.jsonc --env stage', ' -c wrangler.qa.jsonc', ' --config=wrangler.preview.jsonc', ' --dry-run']) {
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

describe('stage', () => {
	const STAGED = ['web', 'admin-web', 'api-videos', 'processor', 'websocket-server', 'scheduler', 'admin-api'];

	it('every app has env.stage and a stage rule, and passes it with production parity', () => {
		for (const app of STAGED) {
			assert.ok(load(app).env?.stage, `${app}: no env.stage`);
			assert.ok(rule(app).stage, `${app}: no stage rule`);
			assert.deepEqual(checkApp(rule(app), load(app)), [], app);
		}
	});

	it('fails when a stage binding points at a production host or a QA resource', () => {
		const config = load('api-videos');
		(config.env!.stage.vars as Record<string, string>).Issuer = 'https://auth.alummahnow.net';
		assert.ok(has(checkApp(rule('api-videos'), config), 'env.stage', 'Issuer'));
		const qa = load('websocket-server');
		(qa.env!.stage.vars as Record<string, string>).WEBSOCKET_URL = 'https://realtime.qa.alummahnow.net';
		assert.ok(checkApp(rule('websocket-server'), qa).some((e) => e.includes('realtime.qa.alummahnow.net')));
	});

	it('fails when stage drops a production binding; a queue consumer may differ only by the -stage suffix', () => {
		const config = load('processor');
		const stage = config.env!.stage as { queues: { consumers: { queue: string }[] }; r2_buckets: unknown[] };
		assert.deepEqual(checkApp(rule('processor'), config), []);
		stage.r2_buckets = stage.r2_buckets.slice(1);
		assert.ok(has(checkApp(rule('processor'), config), 'MESSAGES_BUCKET', 'in production but not in stage'));
		const other = load('processor');
		(other.env!.stage as typeof stage).queues.consumers[0].queue = 'some-other-queue';
		assert.ok(has(checkApp(rule('processor'), other), 'queue_consumer'));
	});
});

describe('logging policy', () => {
	const vars = (config: WranglerConfig, env?: string) =>
		(env ? config.env![env].vars : config.vars) as Record<string, string>;
	const loadQa = (app: string) => parseJsonc(readFileSync(join(ROOT, rule(app).qaConfigPath!), 'utf8')) as WranglerConfig;

	it('every app sets LOG_LEVEL warn on production, stage and QA', () => {
		for (const app of APPS) {
			const config = load(app.app);
			assert.equal(resolveEnv(config, app.production.env).vars.LOG_LEVEL, 'warn', `${app.app} production`);
			assert.equal(resolveEnv(config, 'stage').vars.LOG_LEVEL, 'warn', `${app.app} stage`);
			assert.equal(resolveEnv(loadQa(app.app), null).vars.LOG_LEVEL, 'warn', `${app.app} QA`);
		}
	});

	it('fails when production LOG_LEVEL is missing, chatty or invalid', () => {
		const config = load('api-videos');
		delete vars(config).LOG_LEVEL;
		assert.ok(has(checkApp(rule('api-videos'), config), 'top level', 'LOG_LEVEL is not set'));
		for (const level of ['info', 'debug', 'trace', 'verbose']) {
			vars(config).LOG_LEVEL = level;
			assert.ok(has(checkApp(rule('api-videos'), config), 'LOG_LEVEL', 'not allowed in production'), level);
		}
		vars(config).LOG_LEVEL = 'error';
		assert.ok(!has(checkApp(rule('api-videos'), config), 'LOG_LEVEL'));
	});

	it('fails when stage ships debug', () => {
		const config = load('web');
		vars(config, 'stage').LOG_LEVEL = 'debug';
		assert.ok(has(checkApp(rule('web'), config), 'env.stage', 'not allowed in stage'));
	});

	it('fails when production samples invocations (that drops error lines too)', () => {
		const config = load('websocket-server');
		(config.observability as { logs: { head_sampling_rate: number } }).logs.head_sampling_rate = 0.1;
		assert.ok(has(checkApp(rule('websocket-server'), config), 'head_sampling_rate must be 1'));
	});

	it('fails when stage or QA samples invocations or keeps invocation logs', () => {
		const config = load('web');
		const stage = (config.env as Record<string, { observability: { logs: { head_sampling_rate: number; invocation_logs?: boolean } } }>).stage;
		stage.observability.logs.head_sampling_rate = 0.1;
		assert.ok(has(checkApp(rule('web'), config), 'env.stage', 'head_sampling_rate must be 1'));
		delete stage.observability.logs.invocation_logs;
		assert.ok(has(checkApp(rule('web'), config), 'env.stage', 'invocation_logs must be false'));
		const qa = loadQa('processor');
		(qa.observability as { logs: { invocation_logs?: boolean } }).logs.invocation_logs = true;
		assert.ok(has(checkLogPolicy('processor', resolveEnv(qa, null), 'qa'), 'QA config', 'invocation_logs must be false'));
	});

	it('fails when observability logs are off', () => {
		const config = load('scheduler');
		delete config.observability;
		assert.ok(has(checkApp(rule('scheduler'), config), 'observability logs are off'));
	});

	it('checks the QA config too', () => {
		const qa = loadQa('processor');
		delete vars(qa).LOG_LEVEL;
		assert.ok(has(checkLogPolicy('processor', resolveEnv(qa, null), 'qa'), 'QA config', 'LOG_LEVEL is not set'));
	});
});
