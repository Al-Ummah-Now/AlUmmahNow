/**
 * @jest-environment node
 */
import {
  appleAppSiteAssociation,
  assetLinks,
  defaultMobileAppsSettings,
  MOBILE_APP_LINK_PATHS,
  normaliseSha256Fingerprint,
  publicAttestationConfig,
  type MobileAppsSettings,
} from '@al-ummah/shared-types';
import { AASA_PATH, ASSET_LINKS_PATH, appAssociationResponse, resetAppAssociationCache } from '../app-association';

const FP_HEX = 'ab'.repeat(32);
const FP = 'AB:'.repeat(31) + 'AB';

function filled(env: 'production' | 'qa' = 'production'): MobileAppsSettings {
  const s = defaultMobileAppsSettings(env);
  s.apple.teamId = 'ABCDE12345';
  for (const app of s.android.apps) app.sha256Fingerprints = [FP_HEX];
  return s;
}

/** admin-api `/public/mobile-apps/<file>` as the real handler answers it, from a settings document. */
function adminApi(settings: () => MobileAppsSettings) {
  const calls: string[] = [];
  const fetcher = jest.fn(async (url: string) => {
    calls.push(url);
    const doc = url.endsWith('/assetlinks.json') ? assetLinks(settings()) : appleAppSiteAssociation(settings());
    if (!doc) return new Response(JSON.stringify({ error: 'not_configured' }), { status: 404 });
    return new Response(JSON.stringify(doc), { status: 200 });
  });
  return { fetcher, calls };
}

const env = { ADMIN_API_URL: 'https://admin.api.alummahnow.net' };
const req = (path: string, method = 'GET') => new Request(`https://videos.alummahnow.net${path}`, { method });

beforeEach(() => resetAppAssociationCache());

describe('domain association files from the Mobile apps settings', () => {
  it('builds the AASA from the Team ID and the bundle ids, with the paths per app', () => {
    const doc = appleAppSiteAssociation(filled())!;
    const [viewer, studio] = doc.applinks!.details;
    expect(viewer.appIDs).toEqual(['ABCDE12345.net.alummahnow.viewer', 'ABCDE12345.net.alummahnow.viewer.mac']);
    expect(viewer.components.map((c) => c['/'])).toEqual([...MOBILE_APP_LINK_PATHS.viewer]);
    expect(viewer.components.map((c) => c['/'])).toEqual(expect.arrayContaining(['/app/auth/callback', '/ar/video/*', '/en/@*', '/shorts/*']));
    expect(studio.appIDs).toEqual(['ABCDE12345.net.alummahnow.studio', 'ABCDE12345.net.alummahnow.studio.mac']);
    expect(studio.components.map((c) => c['/'])).toContain('/app/studio/*');
    expect(doc.applinks!.details).toHaveLength(2);
    // Passkeys: Studio and Admin only
    expect(doc.webcredentials!.apps).toEqual([
      'ABCDE12345.net.alummahnow.studio',
      'ABCDE12345.net.alummahnow.studio.mac',
      'ABCDE12345.net.alummahnow.admin',
      'ABCDE12345.net.alummahnow.admin.mac',
    ]);
  });

  it('builds assetlinks per package: links for viewer and Studio, passkeys for Studio and Admin', () => {
    const statements = assetLinks(filled('qa'))!;
    expect(statements).toEqual([
      { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'net.alummahnow.app.qa', sha256_cert_fingerprints: [FP] } },
      {
        relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
        target: { namespace: 'android_app', package_name: 'net.alummahnow.studio.qa', sha256_cert_fingerprints: [FP] },
      },
      { relation: ['delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: 'net.alummahnow.admin.qa', sha256_cert_fingerprints: [FP] } },
    ]);
  });

  it('empty means not served: no Team ID → no AASA; a package without a fingerprint is left out', () => {
    const s = defaultMobileAppsSettings('production');
    expect(appleAppSiteAssociation(s)).toBeNull();
    expect(assetLinks(s)).toBeNull();
    s.android.apps[1].sha256Fingerprints = [FP];
    expect(assetLinks(s)!.map((x) => x.target.package_name)).toEqual(['net.alummahnow.studio']);
    s.apple.teamId = 'ABCDE12345';
    s.apple.apps = [];
    expect(appleAppSiteAssociation(s)).toBeNull();
  });

  it('normalises fingerprints and drops ones that are not SHA-256', () => {
    expect(normaliseSha256Fingerprint(FP_HEX)).toBe(FP);
    expect(normaliseSha256Fingerprint(FP.toLowerCase())).toBe(FP);
    expect(normaliseSha256Fingerprint('AB:CD')).toBeNull();
    const s = filled();
    s.android.apps = [{ role: 'viewer', packageName: 'net.alummahnow.app', sha256Fingerprints: [FP_HEX, FP, 'nope'] }];
    expect(assetLinks(s)![0].target.sha256_cert_fingerprints).toEqual([FP]);
  });

  it('attestation stays off until switched on with its values', () => {
    const s = filled();
    expect(publicAttestationConfig(s)).toEqual({ apple: { enabled: false }, android: { enabled: false, cloudProjectNumber: null } });
    s.apple.appAttest.enabled = true;
    s.android.playIntegrity = { enabled: true, cloudProjectNumber: '123456789012' };
    expect(publicAttestationConfig(s)).toEqual({ apple: { enabled: true }, android: { enabled: true, cloudProjectNumber: '123456789012' } });
    s.apple.teamId = '';
    expect(publicAttestationConfig(s).apple.enabled).toBe(false);
  });
});

describe('the videos Worker serves them (worker.ts → appAssociationResponse)', () => {
  it('passes other paths on to Next', async () => {
    const { fetcher } = adminApi(filled);
    expect(await appAssociationResponse(req('/en/video/abc'), env, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('serves the AASA as 200 application/json, never a redirect, on both locations', async () => {
    const { fetcher, calls } = adminApi(filled);
    for (const path of [AASA_PATH, '/apple-app-site-association']) {
      resetAppAssociationCache();
      const res = (await appAssociationResponse(req(path), env, fetcher))!;
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/json');
      const body = await res.json();
      expect(body.applinks.details[0].appIDs[0]).toBe('ABCDE12345.net.alummahnow.viewer');
    }
    expect(calls[0]).toBe('https://admin.api.alummahnow.net/public/mobile-apps/apple-app-site-association');
  });

  it('serves assetlinks.json from the fingerprints', async () => {
    const { fetcher, calls } = adminApi(filled);
    const res = (await appAssociationResponse(req(ASSET_LINKS_PATH), env, fetcher))!;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((s: { target: { package_name: string } }) => s.target.package_name)).toEqual(['net.alummahnow.app', 'net.alummahnow.studio', 'net.alummahnow.admin']);
    expect(calls[0]).toBe('https://admin.api.alummahnow.net/public/mobile-apps/assetlinks.json');
  });

  it('answers 404 while the settings are empty, and with no admin API configured', async () => {
    const { fetcher } = adminApi(() => defaultMobileAppsSettings('production'));
    expect((await appAssociationResponse(req(AASA_PATH), env, fetcher))!.status).toBe(404);
    expect((await appAssociationResponse(req(ASSET_LINKS_PATH), env, fetcher))!.status).toBe(404);
    resetAppAssociationCache();
    expect((await appAssociationResponse(req(AASA_PATH), {}, fetcher))!.status).toBe(404);
  });

  it('follows a change in the settings after the one-minute isolate cache', async () => {
    let settings = defaultMobileAppsSettings('production');
    const { fetcher } = adminApi(() => settings);
    const t0 = 1_000_000;
    expect((await appAssociationResponse(req(AASA_PATH), env, fetcher, t0))!.status).toBe(404);
    settings = filled();
    expect((await appAssociationResponse(req(AASA_PATH), env, fetcher, t0 + 30_000))!.status).toBe(404);
    expect((await appAssociationResponse(req(AASA_PATH), env, fetcher, t0 + 61_000))!.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good file through an admin-api outage, then answers 503 (never an empty file)', async () => {
    const { fetcher: good } = adminApi(filled);
    const t0 = 2_000_000;
    expect((await appAssociationResponse(req(AASA_PATH), env, good, t0))!.status).toBe(200);
    const down = jest.fn(async () => new Response('oops', { status: 502 }));
    const during = (await appAssociationResponse(req(AASA_PATH), env, down, t0 + 120_000))!;
    expect(during.status).toBe(200);
    expect((await during.json()).applinks).toBeDefined();
    const later = (await appAssociationResponse(req(AASA_PATH), env, down, t0 + 11 * 60_000))!;
    expect(later.status).toBe(503);
    expect(later.headers.get('retry-after')).toBe('60');
  });

  it('refuses a body that is not the file and other methods', async () => {
    const bad = jest.fn(async () => new Response('[]', { status: 200 }));
    expect((await appAssociationResponse(req(ASSET_LINKS_PATH), env, bad))!.status).toBe(503);
    const { fetcher } = adminApi(filled);
    const post = (await appAssociationResponse(req(AASA_PATH, 'POST'), env, fetcher))!;
    expect(post.status).toBe(405);
    const head = (await appAssociationResponse(req(AASA_PATH, 'HEAD'), env, fetcher))!;
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
});
