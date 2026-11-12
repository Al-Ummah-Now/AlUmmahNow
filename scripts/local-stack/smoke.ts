/**
 * Smoke checks of a running local stack (boot.ts without --check), beyond "the port answers":
 *
 *   node --experimental-strip-types --no-warnings scripts/local-stack/smoke.ts
 *
 * - the Auth issuer's discovery document names the local issuer;
 * - every app's OAuth client is registered with its localhost callback (/authorize does not refuse it);
 * - api-videos lists videos (D1/R2 reachable), admin-api and websocket answer;
 * - web and admin-web render a page.
 * Exits 1 on the first failure, with the reason.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR, url, type StackApp } from './stack.ts';

const stack = JSON.parse(readFileSync(join(STATE_DIR, 'stack.json'), 'utf8')) as { apps: Record<string, { url: string }> };
const running = (app: StackApp) => app in stack.apps;
const failures: string[] = [];
const ok = (msg: string) => process.stdout.write(`ok   ${msg}\n`);
const fail = (msg: string) => {
  failures.push(msg);
  process.stdout.write(`FAIL ${msg}\n`);
};

async function get(target: string): Promise<Response> {
  return fetch(target.replace('//localhost:', '//127.0.0.1:'), { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
}

/** Client id and callback of every app that signs in through the issuer (ids: each app's wrangler config). */
const CLIENTS: { app: StackApp; clientId: string; callback: string }[] = [
  { app: 'web', clientId: 'f0de3c30-0304-4ac4-86d6-1e185dec0439', callback: `${url('web')}/api/callback` },
  { app: 'admin-web', clientId: 'a24e39de-601d-463b-b50d-37a0a94e986b', callback: `${url('admin-web')}/api/callback` },
];

async function main(): Promise<void> {
  if (running('auth')) {
    const discovery = (await (await get(`${url('auth')}/.well-known/oauth-authorization-server`)).json()) as { issuer?: string };
    if (discovery.issuer === url('auth')) ok(`issuer ${discovery.issuer}`);
    else fail(`issuer discovery says ${discovery.issuer}, expected ${url('auth')}`);
    for (const client of CLIENTS) {
      const res = await get(`${url('auth')}/authorize?client_id=${client.clientId}&redirect_uri=${encodeURIComponent(client.callback)}&response_type=code&state=smoke`);
      const location = res.headers.get('location') ?? '';
      if (res.status >= 300 && res.status < 400 && !/error=/.test(location) && !location.startsWith(client.callback)) ok(`${client.app} client accepted (${res.status} → ${new URL(location, url('auth')).pathname})`);
      else fail(`${client.app} client: /authorize answered ${res.status} ${location.slice(0, 160)}`);
    }
  }
  if (running('api-videos')) {
    const res = await get(`${url('api-videos')}/api/videos?limit=1`);
    const body = (await res.json().catch(() => ({}))) as { data?: unknown[] };
    if (res.status === 200 && Array.isArray(body.data)) ok('api-videos lists videos');
    else fail(`api-videos /api/videos answered ${res.status}`);
  }
  for (const [app, path] of [['admin-api', '/'], ['websocket', '/'], ['web', '/en'], ['admin-web', '/login'], ['profile', '/'], ['auth-admin', '/']] as [StackApp, string][]) {
    if (!running(app)) continue;
    const res = await get(`${url(app)}${path}`);
    if (res.status < 500) ok(`${app} ${path} → ${res.status}`);
    else fail(`${app} ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  if (failures.length) {
    process.stdout.write(`\n${failures.length} smoke check(s) failed\n`);
    process.exit(1);
  }
}

await main();
