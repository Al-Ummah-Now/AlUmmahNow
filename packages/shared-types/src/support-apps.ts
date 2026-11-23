/**
 * Creator support in the native apps (wiki AUN-MEMBERS MEM-D15, decided 2026-11-23: "add the apps,
 * it's a setting, check patreon and youtube etc."; research/creator-support-in-apps-2026-11-23.md).
 *
 * Every app surface is an admin setting, `hidden` unless an admin chooses otherwise, and the server
 * decides (GET /api/me/features `support`; the checkout API), so a store warning or a court order is
 * answered by flipping a setting, never by shipping an app.
 *
 * - Per platform: iOS (iPhone and iPad), Android, desktop. All off by default.
 * - Per platform and storefront region (an ISO country beats a region group beats nothing = hidden):
 *     hidden                        no button, no link, no "support on the web" text
 *     external_browser_p2p          PayGood's hosted checkout in the system browser, as a
 *                                   person-to-person gift (Apple 3.2.1(vii), Google Play's P2P rule)
 *     external_browser_us_link      the US storefront link-out (Apple 3.1.1(a) US carve-out); US only
 *     external_browser_eu_entitled  Apple EU Attachment 14 / Google EEA external offers; needs the
 *                                   admin's "entitlement and age gate ready" attestation
 * - Cadence per rule: one-time only, or one-time and monthly.
 * - Never Apple or Google in-app purchase: it would take a store cut (breaking 0% to the platform)
 *   and settle to the developer instead of the organization. There is no IAP mode.
 *
 * The gift stays strictly a gift: no perks ever (MEM-D13, owner 2026-11-23) and no digital content
 * in return, which is what keeps the stores' person-to-person exemption simple.
 *
 * Interlocks (the server forces `hidden`, whatever the rule says):
 *   1. P2P needs 100% of the gift to reach the creator: the supporter always covers the card fee and
 *      the organization bears payout fees, unless the admin records the stores' written OK for
 *      deducting third-party processor fees;
 *   2. the EU entitled mode needs the entitlement / age-gate attestation, and only on an EU/EEA storefront;
 *   3. the US link mode only on the US storefront;
 *   4. no storefront country from the app → hidden (stores apply rules by storefront, not by IP).
 */
import type { SupportPolicy } from './support';

export const APP_PLATFORMS = ['ios', 'android', 'desktop'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const APP_SUPPORT_MODES = ['hidden', 'external_browser_p2p', 'external_browser_us_link', 'external_browser_eu_entitled'] as const;
export type AppSupportMode = (typeof APP_SUPPORT_MODES)[number];

export const APP_CADENCES = ['one_time_only', 'one_time_and_monthly'] as const;
export type AppCadence = (typeof APP_CADENCES)[number];

export const APP_REGION_GROUPS = ['US', 'EU_EEA', 'ROW'] as const;
export type AppRegionGroup = (typeof APP_REGION_GROUPS)[number];

/** EU member states plus Iceland, Liechtenstein and Norway (the EEA). */
export const EU_EEA_COUNTRIES: readonly string[] = Object.freeze([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
]);

export interface AppSupportRule {
  platform: AppPlatform;
  /** An ISO 3166-1 alpha-2 storefront country, or a region group ('US', 'EU_EEA', 'ROW') */
  region: string;
  mode: AppSupportMode;
  cadence: AppCadence;
}

export interface AppSupportSettings {
  platforms: Record<AppPlatform, boolean>;
  rules: AppSupportRule[];
  /** Apple and Google confirmed in writing that the card and payout fees may be deducted from a P2P gift */
  storeConfirmedProcessorFeeDeduction: boolean;
  /** Apple EU Attachment 14 / Google EEA external-offers entitlement and the age gate are in place */
  euEntitlementReady: boolean;
}

export const DEFAULT_APP_SUPPORT: AppSupportSettings = Object.freeze({
  platforms: Object.freeze({ ios: false, android: false, desktop: false }) as Record<AppPlatform, boolean>,
  rules: [],
  storeConfirmedProcessorFeeDeduction: false,
  euEntitlementReady: false,
}) as AppSupportSettings;

const COUNTRY = /^[A-Z]{2}$/;

/** Checks stored or submitted app settings; anything malformed reads as the hidden default. */
export function parseAppSupport(input: unknown): { value: AppSupportSettings; ok: boolean } {
  if (input === undefined || input === null) return { value: DEFAULT_APP_SUPPORT, ok: true };
  if (typeof input !== 'object' || Array.isArray(input)) return { value: DEFAULT_APP_SUPPORT, ok: false };
  const src = input as Record<string, unknown>;
  const platforms = { ...DEFAULT_APP_SUPPORT.platforms };
  const p = (src.platforms ?? {}) as Record<string, unknown>;
  for (const k of APP_PLATFORMS) {
    if (p[k] === undefined) continue;
    if (typeof p[k] !== 'boolean') return { value: DEFAULT_APP_SUPPORT, ok: false };
    platforms[k] = p[k] as boolean;
  }
  const rawRules = src.rules ?? [];
  if (!Array.isArray(rawRules) || rawRules.length > 200) return { value: DEFAULT_APP_SUPPORT, ok: false };
  const rules: AppSupportRule[] = [];
  const seen = new Set<string>();
  for (const r of rawRules as Record<string, unknown>[]) {
    const ok =
      r &&
      (APP_PLATFORMS as readonly unknown[]).includes(r.platform) &&
      typeof r.region === 'string' &&
      ((APP_REGION_GROUPS as readonly string[]).includes(r.region) || COUNTRY.test(r.region)) &&
      (APP_SUPPORT_MODES as readonly unknown[]).includes(r.mode) &&
      (APP_CADENCES as readonly unknown[]).includes(r.cadence);
    if (!ok) return { value: DEFAULT_APP_SUPPORT, ok: false };
    const key = `${r.platform}:${r.region}`;
    if (seen.has(key)) return { value: DEFAULT_APP_SUPPORT, ok: false };
    seen.add(key);
    rules.push({ platform: r.platform as AppPlatform, region: r.region as string, mode: r.mode as AppSupportMode, cadence: r.cadence as AppCadence });
  }
  const flag = (v: unknown) => v === true;
  if (src.storeConfirmedProcessorFeeDeduction !== undefined && typeof src.storeConfirmedProcessorFeeDeduction !== 'boolean') return { value: DEFAULT_APP_SUPPORT, ok: false };
  if (src.euEntitlementReady !== undefined && typeof src.euEntitlementReady !== 'boolean') return { value: DEFAULT_APP_SUPPORT, ok: false };
  return { value: { platforms, rules, storeConfirmedProcessorFeeDeduction: flag(src.storeConfirmedProcessorFeeDeduction), euEntitlementReady: flag(src.euEntitlementReady) }, ok: true };
}

/** The app platform an X-AUN-Client header's OS belongs to (null: not a supported app platform). */
export function appPlatformOfOs(os: string | null | undefined): AppPlatform | null {
  const o = (os ?? '').toLowerCase();
  if (/^(ios|ipados|iphoneos)$/.test(o)) return 'ios';
  if (/^android$/.test(o)) return 'android';
  if (/^(macos|osx|mac|windows|linux)$/.test(o)) return 'desktop';
  return null;
}

function regionGroup(country: string): AppRegionGroup {
  if (country === 'US') return 'US';
  return EU_EEA_COUNTRIES.includes(country) ? 'EU_EEA' : 'ROW';
}

export interface AppSupportDecision {
  mode: AppSupportMode;
  cadence: AppCadence;
  /** Why it is hidden, when it is */
  hiddenBecause: null | 'platform_off' | 'no_storefront' | 'no_rule' | 'fees_not_whole' | 'eu_not_ready' | 'us_link_outside_us';
}

/** What a native app on `platform`, in the store of `storefront`, may show (never more than the rule). */
export function appSupportMode(input: { settings: AppSupportSettings; platform: AppPlatform; storefront: string | null; policy: Pick<SupportPolicy, 'collectorFeePayer' | 'payoutFeeBearer'> }): AppSupportDecision {
  const hidden = (why: AppSupportDecision['hiddenBecause']): AppSupportDecision => ({ mode: 'hidden', cadence: 'one_time_only', hiddenBecause: why });
  const { settings, platform } = input;
  if (!settings.platforms[platform]) return hidden('platform_off');
  const storefront = (input.storefront ?? '').toUpperCase();
  if (!COUNTRY.test(storefront)) return hidden('no_storefront');
  const rule = settings.rules.find((r) => r.platform === platform && r.region === storefront) ?? settings.rules.find((r) => r.platform === platform && r.region === regionGroup(storefront));
  if (!rule || rule.mode === 'hidden') return hidden('no_rule');
  if (rule.mode === 'external_browser_p2p') {
    const whole = input.policy.collectorFeePayer === 'supporterAlways' && input.policy.payoutFeeBearer === 'organization';
    if (!whole && !settings.storeConfirmedProcessorFeeDeduction) return hidden('fees_not_whole');
  }
  if (rule.mode === 'external_browser_eu_entitled' && (!settings.euEntitlementReady || !EU_EEA_COUNTRIES.includes(storefront))) return hidden('eu_not_ready');
  if (rule.mode === 'external_browser_us_link' && storefront !== 'US') return hidden('us_link_outside_us');
  return { mode: rule.mode, cadence: rule.cadence, hiddenBecause: null };
}

/** The header the apps send with their store's storefront country (StoreKit / Play Billing). */
export const STOREFRONT_HEADER = 'X-AUN-Storefront';
