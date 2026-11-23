/**
 * Mobile apps settings (videos admin → Settings → Mobile apps, wiki E23 / NAT-REL).
 *
 * One audited document in admin-api `site_settings` (key `mobile_apps`), per environment. It drives:
 *   - the domain association files the videos web app serves on its own host
 *     (`/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`, AlUmmahNow#411):
 *     universal links / App Links for the viewer and Studio, and passkey (webcredentials /
 *     get_login_creds) entries for Studio and Admin;
 *   - native app attestation in api-videos (App Attest / Play Integrity, AlUmmahNow#1274).
 *
 * Every value here is public by nature (it is published in those files), so the whole document is
 * served at admin-api `/public/mobile-apps`. Nothing secret belongs in it.
 *
 * Empty means off: no Team ID → no Apple entries; an Android app without a fingerprint → not
 * listed; a file with nothing in it is not served at all (404), and attestation stays off until it
 * is switched on here with the values it needs.
 */
import { z } from 'zod';

export const MOBILE_APPS_SETTING_KEY = 'mobile_apps';

export const MOBILE_APP_ROLES = ['viewer', 'studio', 'admin'] as const;
export type MobileAppRole = (typeof MOBILE_APP_ROLES)[number];

export const APPLE_TEAM_ID = /^[A-Z0-9]{10}$/;
export const APPLE_BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
/** Google Cloud project number (digits), used by Play Integrity standard requests. */
export const CLOUD_PROJECT_NUMBER = /^\d{6,20}$/;
/** An OAuth client id as Auth issues them (uuid or slug). */
export const OAUTH_CLIENT_ID = /^[A-Za-z0-9._:-]{3,100}$/;

/** "aa:bb…", "AABB…" or with spaces → "AA:BB:…" (the form Digital Asset Links expects), or null. */
export function normaliseSha256Fingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.replace(/[:\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g)!.join(':');
}

const Role = z.enum(MOBILE_APP_ROLES);

export const MobileAppsSettingsSchema = z
  .object({
    apple: z.object({
      /** 10-character Apple Developer Team ID; '' until the owner has one. */
      teamId: z.union([z.literal(''), z.string().regex(APPLE_TEAM_ID, 'Team ID is 10 capital letters or digits')]),
      /** Optional App Clip bundle id (E22-D8, e.g. net.alummahnow.viewer.clip); '' disables AASA appclips. */
      appClipBundleId: z.union([z.literal(''), z.string().regex(APPLE_BUNDLE_ID, 'Not a bundle id')]).optional(),
      apps: z.array(z.object({ role: Role, bundleId: z.string().regex(APPLE_BUNDLE_ID, 'Not a bundle id') })).max(20),
      appAttest: z.object({
        enabled: z.boolean(),
        /** `production` for TestFlight / App Store builds; `development` for Xcode debug builds. */
        environment: z.enum(['production', 'development']),
      }),
    }),
    android: z.object({
      apps: z
        .array(
          z.object({
            role: Role,
            packageName: z.string().regex(ANDROID_PACKAGE, 'Not a package name'),
            sha256Fingerprints: z
              .array(z.string().refine((v) => normaliseSha256Fingerprint(v) !== null, 'A SHA-256 fingerprint is 64 hex digits'))
              .max(10),
          })
        )
        .max(20),
      playIntegrity: z.object({
        enabled: z.boolean(),
        cloudProjectNumber: z.union([z.literal(''), z.string().regex(CLOUD_PROJECT_NUMBER, 'A project number is digits only')]),
      }),
    }),
    attestation: z.object({
      /**
       * OAuth client ids of native apps whose protected writes must carry an attestation proof.
       * Empty: proofs are accepted when sent, never required (the signed-client exemption stays).
       */
      enforceClientIds: z.array(z.string().regex(OAUTH_CLIENT_ID, 'Not a client id')).max(20),
    }),
  })
  .superRefine((s, ctx) => {
    if (s.apple.appAttest.enabled && !s.apple.teamId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apple', 'appAttest', 'enabled'], message: 'App Attest needs the Team ID' });
    }
    if (s.apple.appAttest.enabled && !s.apple.apps.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apple', 'appAttest', 'enabled'], message: 'App Attest needs at least one bundle id' });
    }
    if (s.android.playIntegrity.enabled && !s.android.playIntegrity.cloudProjectNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['android', 'playIntegrity', 'enabled'], message: 'Play Integrity needs the Cloud project number' });
    }
    if (s.android.playIntegrity.enabled && !s.android.apps.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['android', 'playIntegrity', 'enabled'], message: 'Play Integrity needs at least one package' });
    }
    const bundles = s.apple.apps.map((a) => a.bundleId);
    if (new Set(bundles).size !== bundles.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apple', 'apps'], message: 'A bundle id is listed twice' });
    if (s.apple.appClipBundleId && bundles.includes(s.apple.appClipBundleId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apple', 'appClipBundleId'], message: 'The App Clip needs its own bundle id' });
    }
    const packages = s.android.apps.map((a) => a.packageName);
    if (new Set(packages).size !== packages.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['android', 'apps'], message: 'A package is listed twice' });
  });

export type MobileAppsSettings = z.infer<typeof MobileAppsSettingsSchema>;

export type MobileAppsEnvironment = 'production' | 'stage' | 'qa' | 'local';

/**
 * The ids the native repos build (AlUmmahNowApple project.yml, AlUmmahNowAndroid docs/RELEASE.md),
 * so the owner only pastes the Team ID and the fingerprints. QA (and local) builds carry `.qa`;
 * stage serves the production apps. tvOS / Android TV have no web links and are not listed.
 */
export function defaultMobileAppsSettings(environment: MobileAppsEnvironment): MobileAppsSettings {
  const suffix = environment === 'qa' || environment === 'local' ? '.qa' : '';
  return {
    apple: {
      teamId: '',
      appClipBundleId: `net.alummahnow.viewer.clip${suffix}`,
      apps: [
        { role: 'viewer', bundleId: `net.alummahnow.viewer${suffix}` },
        { role: 'viewer', bundleId: `net.alummahnow.viewer.mac${suffix}` },
        { role: 'studio', bundleId: `net.alummahnow.studio${suffix}` },
        { role: 'studio', bundleId: `net.alummahnow.studio.mac${suffix}` },
        { role: 'admin', bundleId: `net.alummahnow.admin${suffix}` },
        { role: 'admin', bundleId: `net.alummahnow.admin.mac${suffix}` },
      ],
      appAttest: { enabled: false, environment: 'production' },
    },
    android: {
      apps: [
        { role: 'viewer', packageName: `net.alummahnow.app${suffix}`, sha256Fingerprints: [] },
        { role: 'studio', packageName: `net.alummahnow.studio${suffix}`, sha256Fingerprints: [] },
        { role: 'admin', packageName: `net.alummahnow.admin${suffix}`, sha256Fingerprints: [] },
      ],
      playIntegrity: { enabled: false, cloudProjectNumber: '' },
    },
    attestation: { enforceClientIds: [] },
  };
}

/** A stored value that no longer parses (or none) falls back to the defaults, so a bad row never breaks a page. */
export function parseMobileAppsSettings(raw: unknown, environment: MobileAppsEnvironment): MobileAppsSettings {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return defaultMobileAppsSettings(environment);
    }
  }
  const parsed = MobileAppsSettingsSchema.safeParse(value);
  if (!parsed.success) return defaultMobileAppsSettings(environment);
  return canonicalMobileAppsSettings(parsed.data);
}

/** Fingerprints in AA:BB form without duplicates, ids trimmed: the form that is stored and compared. */
export function canonicalMobileAppsSettings(s: MobileAppsSettings): MobileAppsSettings {
  const clip = s.apple.appClipBundleId?.trim();
  return {
    apple: {
      ...s.apple,
      ...(clip !== undefined ? { appClipBundleId: clip } : {}),
      apps: s.apple.apps.map((a) => ({ role: a.role, bundleId: a.bundleId.trim() })),
    },
    android: {
      ...s.android,
      apps: s.android.apps.map((a) => ({
        role: a.role,
        packageName: a.packageName.trim(),
        sha256Fingerprints: [...new Set(a.sha256Fingerprints.map(normaliseSha256Fingerprint).filter((f): f is string => !!f))],
      })),
    },
    attestation: { enforceClientIds: [...new Set(s.attestation.enforceClientIds.map((id) => id.trim()))] },
  };
}

// ---------------------------------------------------------------------------
// Domain association files
// ---------------------------------------------------------------------------

/** Watch, Shorts, playlist, post and channel URLs of the videos site, with and without a locale. */
const VIEWER_SECTIONS = ['video', 'shorts', 'playlist', 'post'];
const LOCALES = ['en', 'ar'];

function localised(path: string): string[] {
  return [...LOCALES.map((l) => `/${l}${path}`), path];
}

/**
 * The paths each app opens from a link on the videos host (fixed: they follow the site's routes).
 * Admin opens no web links; it is listed only for passkeys.
 */
export const MOBILE_APP_LINK_PATHS: Record<MobileAppRole, readonly string[]> = {
  viewer: ['/app/auth/callback', ...VIEWER_SECTIONS.flatMap((s) => localised(`/${s}/*`)), ...localised('/@*')],
  studio: ['/app/studio/*', ...localised('/studio/*')],
  admin: [],
};

/** Short-link paths on alummahnow.link that open the Viewer app (and App Clip for /v/* and /s/*). */
export const SHORT_LINK_APP_PATHS: readonly string[] = Object.freeze(['/v/*', '/s/*', '/@*', '/c/*', '/p/*', '/l/*', '/e/*']);

/** Roles that sign in with passkeys in the native apps (AUTH-PASSKEYS "Native apps"). */
const PASSKEY_ROLES: readonly MobileAppRole[] = ['studio', 'admin'];

export interface AppleAppSiteAssociation {
  applinks?: { details: { appIDs: string[]; components: { '/': string }[] }[] };
  webcredentials?: { apps: string[] };
  appclips?: { apps: string[] };
}

/** The AASA document for the videos site, or null when there is nothing to publish (no Team ID or no app). */
export function appleAppSiteAssociation(s: MobileAppsSettings): AppleAppSiteAssociation | null {
  const team = s.apple.teamId;
  if (!APPLE_TEAM_ID.test(team)) return null;
  const details: { appIDs: string[]; components: { '/': string }[] }[] = [];
  for (const role of MOBILE_APP_ROLES) {
    const paths = MOBILE_APP_LINK_PATHS[role];
    const ids = s.apple.apps.filter((a) => a.role === role).map((a) => `${team}.${a.bundleId}`);
    if (paths.length && ids.length) details.push({ appIDs: ids, components: paths.map((p) => ({ '/': p })) });
  }
  const webcredentials = s.apple.apps.filter((a) => PASSKEY_ROLES.includes(a.role)).map((a) => `${team}.${a.bundleId}`);
  const hasViewer = s.apple.apps.some((a) => a.role === 'viewer');
  const clipBundle = s.apple.appClipBundleId?.trim() ?? '';
  const appclips = hasViewer && APPLE_BUNDLE_ID.test(clipBundle) ? [`${team}.${clipBundle}`] : [];
  if (!details.length && !webcredentials.length) return null;
  const doc: AppleAppSiteAssociation = {};
  if (details.length) doc.applinks = { details };
  if (webcredentials.length) doc.webcredentials = { apps: webcredentials };
  if (appclips.length) doc.appclips = { apps: appclips };
  return doc;
}

/** The AASA document for alummahnow.link (Viewer universal links + App Clips; no webcredentials on short-links). */
export function shortLinksAppleAppSiteAssociation(s: MobileAppsSettings): AppleAppSiteAssociation | null {
  const team = s.apple.teamId;
  if (!APPLE_TEAM_ID.test(team)) return null;
  const viewerIds = s.apple.apps.filter((a) => a.role === 'viewer').map((a) => `${team}.${a.bundleId}`);
  if (!viewerIds.length) return null;
  const clipBundle = s.apple.appClipBundleId?.trim() ?? '';
  const doc: AppleAppSiteAssociation = {
    applinks: { details: [{ appIDs: viewerIds, components: SHORT_LINK_APP_PATHS.map((p) => ({ '/': p })) }] },
  };
  if (APPLE_BUNDLE_ID.test(clipBundle)) doc.appclips = { apps: [`${team}.${clipBundle}`] };
  return doc;
}

/** Android Digital Asset Links for alummahnow.link (Viewer handle_all_urls only; no passkey get_login_creds). */
export function shortLinksAssetLinks(s: MobileAppsSettings): AssetLinkStatement[] | null {
  const statements: AssetLinkStatement[] = [];
  for (const app of s.android.apps) {
    if (app.role !== 'viewer') continue;
    const fingerprints = [...new Set(app.sha256Fingerprints.map(normaliseSha256Fingerprint).filter((f): f is string => !!f))];
    if (!fingerprints.length) continue;
    statements.push({ relation: [HANDLE_ALL_URLS], target: { namespace: 'android_app', package_name: app.packageName, sha256_cert_fingerprints: fingerprints } });
  }
  return statements.length ? statements : null;
}

export interface AssetLinkStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';
const GET_LOGIN_CREDS = 'delegate_permission/common.get_login_creds';

/** One statement per Android app that has a fingerprint; null when none has. */
export function assetLinks(s: MobileAppsSettings): AssetLinkStatement[] | null {
  const statements: AssetLinkStatement[] = [];
  for (const app of s.android.apps) {
    const fingerprints = [...new Set(app.sha256Fingerprints.map(normaliseSha256Fingerprint).filter((f): f is string => !!f))];
    if (!fingerprints.length) continue;
    const relation: string[] = [];
    if (MOBILE_APP_LINK_PATHS[app.role].length) relation.push(HANDLE_ALL_URLS);
    if (PASSKEY_ROLES.includes(app.role)) relation.push(GET_LOGIN_CREDS);
    if (!relation.length) continue;
    statements.push({ relation, target: { namespace: 'android_app', package_name: app.packageName, sha256_cert_fingerprints: fingerprints } });
  }
  return statements.length ? statements : null;
}

// ---------------------------------------------------------------------------
// Attestation (what the apps read from api-videos `/api/apps/attestation/config`)
// ---------------------------------------------------------------------------

export interface PublicAttestationConfig {
  apple: { enabled: boolean };
  android: { enabled: boolean; cloudProjectNumber: string | null };
}

export function publicAttestationConfig(s: MobileAppsSettings): PublicAttestationConfig {
  const apple = s.apple.appAttest.enabled && APPLE_TEAM_ID.test(s.apple.teamId) && s.apple.apps.length > 0;
  const android = s.android.playIntegrity.enabled && CLOUD_PROJECT_NUMBER.test(s.android.playIntegrity.cloudProjectNumber) && s.android.apps.length > 0;
  return {
    apple: { enabled: apple },
    android: { enabled: android, cloudProjectNumber: android ? s.android.playIntegrity.cloudProjectNumber : null },
  };
}

/** The header native apps send their attestation proof in (AlUmmahNow#1274). */
export const NATIVE_PROOF_HEADER = 'X-AUN-Native-Proof';
