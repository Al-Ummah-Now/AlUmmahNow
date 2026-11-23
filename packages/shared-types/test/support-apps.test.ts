/**
 * MEM-D15 (owner 2026-11-23): creator support in the native apps is an admin setting, hidden by
 * default, never Apple or Google in-app purchase, with the server's interlocks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as a from '../src/support-apps.ts';

const whole = { collectorFeePayer: 'supporterAlways', payoutFeeBearer: 'organization' } as const;
const notWhole = { collectorFeePayer: 'creatorSupporterMayCover', payoutFeeBearer: 'creatorFromPayout' } as const;
const settings = (over: Partial<a.AppSupportSettings> = {}): a.AppSupportSettings => ({ ...a.DEFAULT_APP_SUPPORT, platforms: { ios: true, android: true, desktop: true }, ...over });

test('no in-app purchase mode exists, and every platform starts hidden', () => {
  assert.ok(!a.APP_SUPPORT_MODES.some((m) => /iap|in_app/i.test(m)));
  for (const platform of a.APP_PLATFORMS) {
    assert.equal(a.appSupportMode({ settings: a.DEFAULT_APP_SUPPORT, platform, storefront: 'US', perksOn: false, policy: whole }).mode, 'hidden');
  }
});

test('a storefront country rule beats its region group; no storefront is hidden', () => {
  const s = settings({
    rules: [
      { platform: 'ios', region: 'ROW', mode: 'external_browser_p2p', cadence: 'one_time_and_monthly' },
      { platform: 'ios', region: 'GB', mode: 'hidden', cadence: 'one_time_only' },
    ],
  });
  assert.equal(a.appSupportMode({ settings: s, platform: 'ios', storefront: 'EG', perksOn: false, policy: whole }).mode, 'external_browser_p2p');
  assert.equal(a.appSupportMode({ settings: s, platform: 'ios', storefront: 'GB', perksOn: false, policy: whole }).hiddenBecause, 'no_rule');
  assert.equal(a.appSupportMode({ settings: s, platform: 'ios', storefront: null, perksOn: false, policy: whole }).hiddenBecause, 'no_storefront');
  assert.equal(a.appSupportMode({ settings: s, platform: 'ios', storefront: 'FR', perksOn: false, policy: whole }).hiddenBecause, 'no_rule', 'FR is EU_EEA, not ROW');
});

test('interlocks: perks, fees not whole, EU attestation, US-only link', () => {
  const p2p = settings({ rules: [{ platform: 'android', region: 'ROW', mode: 'external_browser_p2p', cadence: 'one_time_only' }] });
  assert.equal(a.appSupportMode({ settings: p2p, platform: 'android', storefront: 'EG', perksOn: true, policy: whole }).hiddenBecause, 'perks_on');
  assert.equal(a.appSupportMode({ settings: p2p, platform: 'android', storefront: 'EG', perksOn: false, policy: notWhole }).hiddenBecause, 'fees_not_whole');
  assert.equal(a.appSupportMode({ settings: { ...p2p, storeConfirmedProcessorFeeDeduction: true }, platform: 'android', storefront: 'EG', perksOn: false, policy: notWhole }).mode, 'external_browser_p2p');
  const eu = settings({ rules: [{ platform: 'ios', region: 'EU_EEA', mode: 'external_browser_eu_entitled', cadence: 'one_time_only' }] });
  assert.equal(a.appSupportMode({ settings: eu, platform: 'ios', storefront: 'DE', perksOn: true, policy: notWhole }).hiddenBecause, 'eu_not_ready');
  assert.equal(a.appSupportMode({ settings: { ...eu, euEntitlementReady: true }, platform: 'ios', storefront: 'DE', perksOn: true, policy: notWhole }).mode, 'external_browser_eu_entitled', 'perks do not block the EU mode');
  const us = settings({ rules: [{ platform: 'ios', region: 'CA', mode: 'external_browser_us_link', cadence: 'one_time_only' }] });
  assert.equal(a.appSupportMode({ settings: us, platform: 'ios', storefront: 'CA', perksOn: false, policy: whole }).hiddenBecause, 'us_link_outside_us');
});

test('the cadence gate comes from the matching rule', () => {
  const s = settings({ rules: [{ platform: 'desktop', region: 'US', mode: 'external_browser_us_link', cadence: 'one_time_only' }] });
  assert.equal(a.appSupportMode({ settings: s, platform: 'desktop', storefront: 'us', perksOn: false, policy: notWhole }).cadence, 'one_time_only');
});

test('parsing refuses malformed settings, duplicates and unknown modes; missing reads as hidden', () => {
  assert.deepEqual(a.parseAppSupport(null), { value: a.DEFAULT_APP_SUPPORT, ok: true });
  assert.equal(a.parseAppSupport({ rules: [{ platform: 'ios', region: 'US', mode: 'iap', cadence: 'one_time_only' }] }).ok, false);
  assert.equal(a.parseAppSupport({ rules: [{ platform: 'ios', region: 'us', mode: 'hidden', cadence: 'one_time_only' }] }).ok, false);
  const dup = { platform: 'ios', region: 'US', mode: 'hidden', cadence: 'one_time_only' };
  assert.equal(a.parseAppSupport({ rules: [dup, dup] }).ok, false);
  assert.equal(a.parseAppSupport({ platforms: { ios: 'yes' } }).ok, false);
  const ok = a.parseAppSupport({ platforms: { android: true }, rules: [dup], euEntitlementReady: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.platforms.android, true);
  assert.equal(ok.value.platforms.ios, false);
});

test('the client header OS maps to a platform', () => {
  assert.equal(a.appPlatformOfOs('ipados'), 'ios');
  assert.equal(a.appPlatformOfOs('Android'), 'android');
  assert.equal(a.appPlatformOfOs('windows'), 'desktop');
  assert.equal(a.appPlatformOfOs('tvos'), null);
  assert.equal(a.appPlatformOfOs(undefined), null);
});
