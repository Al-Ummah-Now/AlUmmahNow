/**
 * @jest-environment node
 */
import { SKEW_HOST_HEADER } from '../skew-host';
import { skewRequest, SKEW_SIGNATURE_HEADER, type SkewHopEnv } from '../skew-hop';

const env: SkewHopEnv = { CF_WORKER_NAME: 'al-ummah-now-production', CF_PREVIEW_DOMAIN: 'acct', CF_DEPLOYMENT_MAPPING: JSON.stringify({ now: 'current', old: '1a2b3c4d-0000-4000-8000-000000000000' }), INTERNAL_API_KEY: { get: async () => 'k1' } };
const NOW = Date.parse('2026-11-25T12:00:30Z');
const VERSION = '1a2b3c4d-al-ummah-now-production.acct.workers.dev';

const open = (path = '/en/upload?x=1', init: RequestInit = {}) => new Request(`https://videos.alummahnow.net${path}`, { ...init, headers: { 'x-deployment-id': 'old', ...(init.headers as Record<string, string>) } });
/** What OpenNext sends to the old version. */
const forwarded = (signed: Request, host = VERSION, path?: string) => {
  const url = new URL(signed.url);
  url.hostname = host;
  return new Request(path ? new URL(path, url) : url, signed);
};
const sign = async (req: Request, e = env, at = NOW) => (await skewRequest(req, e, at))!;

describe('the skew hop', () => {
  it('an old version answers what the current one signed, with the public host and no signature', async () => {
    const out = await skewRequest(forwarded(await sign(open('/en/upload?x=1', { method: 'POST', body: '["a"]' }))), env, NOW + 60_000);
    expect(out!.url).toBe('https://videos.alummahnow.net/en/upload?x=1');
    expect(out!.headers.has(SKEW_SIGNATURE_HEADER)).toBe(false);
    expect([out!.method, await out!.text()]).toEqual(['POST', '["a"]']);
  });

  it('signs only a request OpenNext forwards, from the first request of an isolate, and never keeps a client signature', async () => {
    const forged = { [SKEW_SIGNATURE_HEADER]: 'f'.repeat(64) };
    const unsigned: [string, Request, SkewHopEnv?][] = [
      ['no build', new Request('https://videos.alummahnow.net/en', { headers: forged })],
      ['the current build', new Request('https://videos.alummahnow.net/en', { headers: { ...forged, 'x-deployment-id': 'now' } })],
      ['the current build by ?dpl=', new Request('https://videos.alummahnow.net/_next/static/a.js?dpl=now', { headers: forged })],
      ['a build that is not mapped', new Request('https://videos.alummahnow.net/en', { headers: { ...forged, 'x-deployment-id': 'ancient' } })],
      ['a property name', new Request('https://videos.alummahnow.net/en', { headers: { ...forged, 'x-deployment-id': 'constructor' } })],
      ['another of our hosts', new Request('https://other.alummahnow.net/en', { headers: { ...forged, 'x-deployment-id': 'old' } })],
      ['no mapping', open('/en', { headers: forged }), { ...env, CF_DEPLOYMENT_MAPPING: undefined }],
      ['a broken mapping', open('/en', { headers: forged }), { ...env, CF_DEPLOYMENT_MAPPING: '{' }],
    ];
    for (const [name, req, e = env] of unsigned) expect([name, (await sign(req, e)).headers.has(SKEW_SIGNATURE_HEADER)]).toEqual([name, false]);
    for (const req of [open(), new Request('https://videos.alummahnow.net/_next/static/a.js?dpl=old', { headers: forged })]) {
      expect((await sign(req)).headers.get(SKEW_SIGNATURE_HEADER)).toMatch(/^(?!f{64})[0-9a-f]{64}$/);
    }
  });

  it('accepts a signature from the minute before or after', async () => {
    const good = await sign(open());
    expect(await skewRequest(forwarded(good), env, NOW + 60_000)).not.toBeNull();
    expect(await skewRequest(forwarded(good), env, NOW - 60_000)).not.toBeNull();
  });

  it('refuses everything else on a preview URL', async () => {
    const good = await sign(open());
    const stamped = (over: Record<string, string>) => {
      const req = forwarded(good);
      for (const [k, v] of Object.entries(over)) req.headers.set(k, v);
      return req;
    };
    const refused: [string, Request, SkewHopEnv?, number?][] = [
      ['a stamp without a signature', new Request(`https://${VERSION}/en`, { headers: { [SKEW_HOST_HEADER]: 'videos.alummahnow.net' } })],
      ['a wrong signature', stamped({ [SKEW_SIGNATURE_HEADER]: 'f'.repeat(64) })],
      ['another path', forwarded(good, VERSION, '/en/other')],
      ['another query', forwarded(good, VERSION, '/en/upload?x=2')],
      ['another of our hosts', stamped({ [SKEW_HOST_HEADER]: 'admin.alummahnow.net' })],
      ['a lookalike host', stamped({ [SKEW_HOST_HEADER]: 'videos.alummahnow.net.evil.example' })],
      ['another method', new Request(forwarded(good), { method: 'DELETE' })],
      ['the plain address', forwarded(good, 'al-ummah-now-production.acct.workers.dev')],
      ['a branch alias', forwarded(good, 'branch-al-ummah-now-production.acct.workers.dev')],
      ['another account', forwarded(good, '1a2b3c4d-al-ummah-now-production.other.workers.dev')],
      ['another Worker', forwarded(good, '1a2b3c4d-al-ummah-admin-web.acct.workers.dev')],
      ['another environment', forwarded(good), { ...env, INTERNAL_API_KEY: 'k2' }],
      ['no key', forwarded(good), { ...env, INTERNAL_API_KEY: undefined }],
      ['too old', forwarded(good), env, NOW + 121_000],
      ['from the future', forwarded(good), env, NOW - 121_000],
    ];
    for (const [name, req, e = env, at = NOW] of refused) expect([name, await skewRequest(req, e, at)]).toEqual([name, null]);
    expect(await skewRequest(forwarded(good), env, NOW)).not.toBeNull();
  });

  it('the admin app signs and accepts its own hostnames only', async () => {
    const admin = { ...env, CF_WORKER_NAME: 'al-ummah-admin-web' };
    const at = '1a2b3c4d-al-ummah-admin-web.acct.workers.dev';
    const asked = await sign(new Request('https://admin.alummahnow.net/users', { headers: { 'x-deployment-id': 'old' } }), admin);
    expect(await skewRequest(forwarded(asked, at), admin, NOW)).not.toBeNull();
    expect((await sign(open(), admin)).headers.has(SKEW_SIGNATURE_HEADER)).toBe(false);
    expect(await skewRequest(forwarded(await sign(open()), at), admin, NOW)).toBeNull();
  });

  it('PR previews (no CF_WORKER_NAME) and local development answer as before', async () => {
    expect(await skewRequest(new Request('https://al-ummah-web-pr-12.acct.workers.dev/en'), {}, NOW)).not.toBeNull();
    const local = new Request('http://localhost:3000/');
    expect(await skewRequest(local, env, NOW)).toBe(local);
  });
});
