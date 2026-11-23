/**
 * Epic 22 (E22-S1) shared contracts:
 * - `/e/<streamId>` short-link path and URL generation (`kind: 'live'`)
 * - `appclips` in `appleAppSiteAssociation` + short-links AASA & Asset Links (`E22-D8`)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShortLinkClickEvent, parseShortLinkPath, shortLinkPath, shortLinkUrl } from '../src/short-links.ts';
import {
  MobileAppsSettingsSchema,
  SHORT_LINK_APP_PATHS,
  appleAppSiteAssociation,
  defaultMobileAppsSettings,
  shortLinksAppleAppSiteAssociation,
  shortLinksAssetLinks,
} from '../src/mobile-apps.ts';

test('/e/<streamId> builds and parses live/event short links and click events', () => {
  assert.equal(shortLinkPath({ kind: 'live', id: 'stream-42' }), '/e/stream-42');
  assert.equal(
    shortLinkUrl('https://alummahnow.link', { kind: 'live', id: 'stream-42' }, { lang: 'ar' }),
    'https://alummahnow.link/e/stream-42?lang=ar',
  );
  assert.deepEqual(parseShortLinkPath('/e/stream-42'), { kind: 'live', id: 'stream-42' });
  assert.deepEqual(parseShortLinkPath('/e/stream-42/'), { kind: 'live', id: 'stream-42' });
  assert.equal(isShortLinkClickEvent({ type: 'live', source: 'direct' }), true);
});

test('MobileAppsSettings emits appclips and short-links domain associations when configured', () => {
  const s = defaultMobileAppsSettings('production');
  assert.equal(s.apple.appClipBundleId, 'net.alummahnow.viewer.clip');
  assert.equal(appleAppSiteAssociation(s), null);
  assert.equal(shortLinksAppleAppSiteAssociation(s), null);
  assert.equal(shortLinksAssetLinks(s), null);

  s.apple.teamId = 'ABCDE12345';
  s.android.apps[0]!.sha256Fingerprints = ['ab'.repeat(32)];
  s.android.apps[1]!.sha256Fingerprints = ['cd'.repeat(32)];

  const videosAasa = appleAppSiteAssociation(s)!;
  assert.deepEqual(videosAasa.appclips, { apps: ['ABCDE12345.net.alummahnow.viewer.clip'] });

  const shortAasa = shortLinksAppleAppSiteAssociation(s)!;
  assert.equal(shortAasa.webcredentials, undefined);
  assert.deepEqual(shortAasa.appclips, { apps: ['ABCDE12345.net.alummahnow.viewer.clip'] });
  assert.deepEqual(shortAasa.applinks?.details[0]?.appIDs, [
    'ABCDE12345.net.alummahnow.viewer',
    'ABCDE12345.net.alummahnow.viewer.mac',
  ]);
  assert.deepEqual(
    shortAasa.applinks?.details[0]?.components.map((c) => c['/']),
    [...SHORT_LINK_APP_PATHS],
  );

  const shortLinks = shortLinksAssetLinks(s)!;
  assert.equal(shortLinks.length, 1);
  assert.equal(shortLinks[0]?.target.package_name, 'net.alummahnow.app');
  assert.deepEqual(shortLinks[0]?.relation, ['delegate_permission/common.handle_all_urls']);

  // Clearing appClipBundleId omits appclips cleanly
  s.apple.appClipBundleId = '';
  assert.equal(appleAppSiteAssociation(s)?.appclips, undefined);
  assert.equal(shortLinksAppleAppSiteAssociation(s)?.appclips, undefined);

  // Reusing the full Viewer bundle id for the App Clip is rejected
  s.apple.appClipBundleId = 'net.alummahnow.viewer';
  const invalid = MobileAppsSettingsSchema.safeParse(s);
  assert.equal(invalid.success, false);
});
