/**
 * The local stack never points at a deployed resource: generated configs drop every remote flag,
 * preview id, route, environment and Workers AI binding, and keep only bindings to workers that run
 * in the stack. Plus the redirect-URI rewrite and the released-ref picker.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../../release/jsonc.ts';
import { LIFTED_LIMIT, LIFTED_LIMITERS, localConfig, localRedirectUri, localRedirectUris, type Json } from '../configs.ts';
import { releasedRun } from '../resolve-refs.ts';
import { bundleTag } from '../fetch-auth.ts';
import { PROD_HOST_TO_LOCAL, ROOT, WORKERS, LOCAL_SECRETS, url } from '../stack.ts';

const videosWorkers = WORKERS.filter((w) => w.repo === 'videos');
const raw = (dir: string, file: string) => parseJsonc(readFileSync(join(ROOT, dir, file), 'utf8')) as Json;

describe('local configs', () => {
  const names = new Set(videosWorkers.map((w) => String(raw(w.dir, w.config).name)));

  for (const worker of videosWorkers) {
    it(`${worker.app}: nothing remote, no deploy-only keys, local URLs`, () => {
      const { config } = localConfig(raw(worker.dir, worker.config), worker, names);
      const text = JSON.stringify(config);
      assert.doesNotMatch(text, /"remote":/, 'a remote binding would use the real resource');
      assert.doesNotMatch(text, /"preview_(id|database_id|bucket_name)":/);
      for (const key of ['env', 'routes', 'ai', 'triggers', 'containers']) assert.ok(!(key in config), `${key} must be dropped`);
      // No var may name a deployed host
      assert.doesNotMatch(JSON.stringify(config.vars), /(https?|wss?):\/\/[^"]*alummahnow\.net|"[\w.-]+\.alummahnow\.net"/, `${worker.app} vars still point at a deployed host`);
      for (const s of (config.services as Json[] | undefined) ?? []) assert.ok(names.has(String(s.service)), `service ${String(s.service)} is not in the stack`);
    });
  }

  it('uses local realtime origins and the same test key for ticket minting', () => {
    const configFor = (app: string) => {
      const worker = videosWorkers.find((w) => w.app === app)!;
      return localConfig(raw(worker.dir, worker.config), worker, names);
    };
    const web = configFor('web').config.vars as Json;
    const admin = configFor('admin-web').config.vars as Json;
    assert.equal(web.WEBSOCKET_URL, `${url('websocket').replace('http:', 'ws:')}/ws`);
    assert.equal(admin.REALTIME_URL, url('websocket'));
    const realtimeKey = configFor('websocket').secrets.find((secret) => secret.binding === 'INTERNAL_API_KEY');
    assert.ok(realtimeKey);
    assert.equal(web.INTERNAL_API_KEY, LOCAL_SECRETS[realtimeKey.binding]);
    assert.equal(admin.INTERNAL_API_KEY, LOCAL_SECRETS[realtimeKey.binding]);
  });

  it('uses matching realtime origins and Secrets Store bindings on QA, stage and production', () => {
    for (const tier of ['qa', 'stage', 'production']) {
      const tierConfig = (app: string, filename: string) => {
        const config = raw(`apps/${app}`, filename);
        return tier === 'stage' ? (config.env as Record<string, Json>).stage : config;
      };
      const browserConfig = tier === 'qa' ? 'wrangler.qa.jsonc' : 'wrangler.production.jsonc';
      const web = tierConfig('web', browserConfig);
      const admin = tierConfig('admin-web', browserConfig);
      const realtime = tierConfig('websocket-server', tier === 'qa' ? 'wrangler.qa.jsonc' : 'wrangler.jsonc');
      const vars = realtime.vars as Json;
      const origin = new URL(String(vars.WEBSOCKET_URL)).origin;
      assert.equal(String((web.vars as Json).WEBSOCKET_URL), `${origin.replace('https:', 'wss:')}/ws`);
      assert.equal((admin.vars as Json).REALTIME_URL, origin);
      for (const config of [web, admin]) {
        assert.equal((config.vars as Json).Issuer, vars.Issuer);
        const binding = (entry: Json) => entry.binding === 'INTERNAL_API_KEY';
        const key = (realtime.secrets_store_secrets as Json[]).find(binding);
        assert.ok(key);
        assert.deepEqual((config.secrets_store_secrets as Json[]).find(binding), key);
      }
    }
  });

  it('drops services and Durable Objects bound to scripts outside the stack', () => {
    const worker = videosWorkers.find((w) => w.app === 'admin-api')!;
    const { config, dropped } = localConfig(
      {
        name: 'x',
        services: [{ binding: 'A', service: 'videos' }, { binding: 'S', service: 'al-ummah-scheduler' }],
        durable_objects: { bindings: [{ name: 'D', class_name: 'C', script_name: 'elsewhere' }, { name: 'E', class_name: 'F' }] },
        d1_databases: [{ binding: 'DB', database_id: 'id', preview_database_id: 'p', remote: true }],
        secrets_store_secrets: [{ binding: 'INTERNAL_API_KEY', store_id: 's', secret_name: 'internal-api-key' }],
      },
      worker,
      new Set(['videos']),
    );
    assert.deepEqual((config.services as Json[]).map((s) => s.binding), ['A']);
    assert.deepEqual((config.durable_objects as { bindings: Json[] }).bindings.map((b) => b.name), ['E']);
    assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_id: 'id' }]);
    assert.ok(dropped.some((d) => d.includes('al-ummah-scheduler')));
  });

  it('collects Secrets Store bindings, and every known secret has a local value', () => {
    const worker = videosWorkers.find((w) => w.app === 'api-videos')!;
    const { secrets } = localConfig(raw(worker.dir, worker.config), worker, names);
    assert.ok(secrets.length > 0);
    // Local values (a key in `<version>:<base64>` form encodes one: "bG9jYWwtc3RhY2st" is "local-stack-"), or
    // Cloudflare's documented always-pass Turnstile test secret
    for (const value of Object.values(LOCAL_SECRETS)) assert.match(value, /^(local-stack-|\d+$|1x0{31}AA$|\d+:bG9jYWwtc3RhY2st)/, 'local values only');
  });

  it('bot protection: Turnstile enforced with the test site key, bot-protection limits lifted, older limits kept', () => {
    for (const app of ['api-videos', 'admin-api'] as const) {
      const worker = videosWorkers.find((w) => w.app === app)!;
      const vars = localConfig(raw(worker.dir, worker.config), worker, names).config.vars as Json;
      assert.equal(vars.TURNSTILE_MODE, 'enforce');
      assert.equal(vars.TURNSTILE_SITE_KEY, '1x00000000000000000000AA');
    }
    assert.equal(LOCAL_SECRETS.TURNSTILE_SECRET, '1x0000000000000000000000000000000AA');
    const api = videosWorkers.find((w) => w.app === 'api-videos')!;
    const limits = new Map(((localConfig(raw(api.dir, api.config), api, names).config.ratelimits as Json[]) ?? []).map((r) => [String(r.name), (r.simple as Json).limit]));
    for (const name of LIFTED_LIMITERS) assert.equal(limits.get(name), LIFTED_LIMIT, name);
    assert.equal(limits.get('WATCH_TIME_LIMITER'), 6);
    // The deployed production config is untouched
    const prod = raw(api.dir, api.config);
    assert.equal((prod.vars as Json).TURNSTILE_MODE, 'monitor');
    assert.equal(((prod.ratelimits as Json[]).find((r) => r.name === 'REPORT_LIMITER')!.simple as Json).limit, 10);
  });

  it('turns paid AI off in the processor', () => {
    const worker = videosWorkers.find((w) => w.app === 'processor')!;
    const { config } = localConfig(raw(worker.dir, worker.config), worker, names);
    assert.ok(!('ai' in config));
    assert.equal((config.vars as Json).AI_MODERATION_ENABLED, 'false');
    assert.equal((config.vars as Json).AI_CATEGORIZE_ENABLED, 'false');
  });
});

describe('redirect URIs', () => {
  it('maps deployed hosts to local origins and keeps the path', () => {
    assert.equal(localRedirectUri('https://videos.alummahnow.net/api/callback?x=1', PROD_HOST_TO_LOCAL), 'http://localhost:3001/api/callback?x=1');
    assert.equal(localRedirectUri('http://localhost:3001/api/callback', PROD_HOST_TO_LOCAL), 'http://localhost:3001/api/callback');
    assert.equal(localRedirectUri('https://unknown.example.com/cb', PROD_HOST_TO_LOCAL), null);
    assert.equal(localRedirectUri('alummahnow://callback', PROD_HOST_TO_LOCAL), null);
  });

  it('deduplicates', () => {
    assert.deepEqual(
      localRedirectUris(['https://videos.alummahnow.net/api/callback', 'http://localhost:3001/api/callback', 'nope'], PROD_HOST_TO_LOCAL),
      ['http://localhost:3001/api/callback'],
    );
  });
});

describe('released refs', () => {
  const run = (head_branch: string, conclusion = 'success', event = 'push') => ({ head_sha: head_branch, head_branch, event, conclusion });
  it('auth: the newest successful push run on main', () => {
    assert.equal(releasedRun([run('feature'), run('main', 'failure'), run('main')], 'main')?.head_sha, 'main');
  });
  it('cms/www: the newest successful tag run', () => {
    assert.equal(releasedRun([run('main'), run('v2026.11.12', 'failure'), run('v2026.11.11.6')], 'tag')?.head_branch, 'v2026.11.11.6');
    assert.equal(releasedRun([run('main')], 'tag'), undefined);
  });
});

describe('Auth bundle', () => {
  it('is published per released commit as local-stack-<sha12>', () => {
    assert.equal(bundleTag('e382a4370348f2497975662177f14efce12d406d'), 'local-stack-e382a4370348');
    assert.throws(() => bundleTag('e382a43'));
  });
});
