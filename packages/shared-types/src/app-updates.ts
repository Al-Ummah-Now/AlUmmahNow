/**
 * App updates (wiki AUN-APP-UPDATES): channels, install sources and the signed release manifest
 * (`app-release.json` + `app-release.json.sig`) every app repo's release workflow publishes on its
 * GitHub release. api-videos indexes verified manifests; desktop apps verify them again themselves
 * before installing anything. Runs on Workers and Node (WebCrypto Ed25519).
 */
import { z } from 'zod';
import { APP_CONFIG_APPS, APP_CONFIG_PLATFORMS, APP_CONFIG_SEMVER, compareAppVersions } from './app-config';

export const APP_UPDATE_CHANNELS = ['stable', 'beta'] as const;
export type AppUpdateChannel = (typeof APP_UPDATE_CHANNELS)[number];

/** Where a build was installed from; decides what Update does (wiki §2.3). */
export const APP_UPDATE_SOURCES = ['appstore', 'testflight', 'play', 'amazon', 'msstore', 'direct', 'managed', 'samsung'] as const;
export type AppUpdateSource = (typeof APP_UPDATE_SOURCES)[number];

export const APP_UPDATE_ARCHES = ['x64', 'arm64', 'universal'] as const;
export type AppUpdateArch = (typeof APP_UPDATE_ARCHES)[number];

export const APP_RELEASE_ARTIFACT_KINDS = ['velopack-full', 'velopack-delta', 'sparkle-zip', 'msi', 'msix', 'zip', 'dmg', 'pkg', 'exe', 'deb', 'flatpak', 'tar', 'apk', 'appinstaller'] as const;
export type AppReleaseArtifactKind = (typeof APP_RELEASE_ARTIFACT_KINDS)[number];

/** The repos that publish release manifests, all under github.com/Al-Ummah-Now. */
export const APP_RELEASE_REPOS = ['AlUmmahNowDesktop', 'AlUmmahNowTools', 'AlUmmahNowApple', 'AlUmmahNowAndroid'] as const;
export type AppReleaseRepo = (typeof APP_RELEASE_REPOS)[number];

export const APP_RELEASE_NOTES_MAX = 1500;

/**
 * Release tag prefixes (wiki AUN-APP-UPDATES §2.1), longest first: `v` for any app, `admin-v` for AlUmmahNowApple's
 * staff Admin app, `admin-windows-v` for AlUmmahNowDesktop's Admin for Windows. aun-core `parse_release_tag` and the
 * release tool follow the same rule (shared cases: AlUmmahNowCore spec/app-updates/tags.json).
 */
export const APP_RELEASE_TAG_PREFIXES = ['admin-windows-v', 'admin-v', 'v'] as const;
export type AppReleaseTagPrefix = (typeof APP_RELEASE_TAG_PREFIXES)[number];
export const APP_RELEASE_TAG = /^(?:admin-windows-v|admin-v|v)[0-9A-Za-z.+-]{1,64}$/;

export interface AppReleaseTag {
  prefix: AppReleaseTagPrefix;
  /** The tag's app version (`admin-v1.2.3-2` → `1.2.3.2`) */
  version: string;
  /** An `admin-` tag releases only the staff Admin app */
  adminOnly: boolean;
}

/** A release tag's prefix and version; null when it isn't one. A trailing `-N` (one or two digits) is the 4th part. */
export function parseAppReleaseTag(tag: string): AppReleaseTag | null {
  if (!APP_RELEASE_TAG.test(tag)) return null;
  const prefix = APP_RELEASE_TAG_PREFIXES.find((p) => tag.startsWith(p))!;
  const bare = tag.slice(prefix.length);
  const rebuild = /^(\d+\.\d+\.\d+)-(\d{1,2})$/.exec(bare);
  const version = rebuild ? `${rebuild[1]}.${rebuild[2]}` : bare;
  if (!APP_CONFIG_SEMVER.test(version)) return null;
  return { prefix, version, adminOnly: prefix !== 'v' };
}
export const APP_RELEASE_MANIFEST_MAX_BYTES = 256 * 1024;

const notesText = z.string().trim().min(1).max(APP_RELEASE_NOTES_MAX);
export const AppReleaseNotesSchema = z.object({ en: notesText, ar: notesText }).strict();
export type AppReleaseNotes = z.infer<typeof AppReleaseNotesSchema>;

export const AppReleaseArtifactSchema = z
  .object({
    app: z.enum(APP_CONFIG_APPS),
    platform: z.enum(APP_CONFIG_PLATFORMS),
    arch: z.enum(APP_UPDATE_ARCHES).optional(),
    kind: z.enum(APP_RELEASE_ARTIFACT_KINDS),
    url: z.string().url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().positive(),
  })
  .strict();
export type AppReleaseArtifact = z.infer<typeof AppReleaseArtifactSchema>;

export const AppReleaseStoreSchema = z
  .object({
    app: z.enum(APP_CONFIG_APPS),
    platform: z.enum(APP_CONFIG_PLATFORMS),
    source: z.enum(APP_UPDATE_SOURCES),
  })
  .strict();
export type AppReleaseStore = z.infer<typeof AppReleaseStoreSchema>;

export const AppReleaseManifestSchema = z
  .object({
    schema: z.literal(1),
    repo: z.enum(APP_RELEASE_REPOS),
    tag: z.string().regex(APP_RELEASE_TAG),
    version: z.string().regex(APP_CONFIG_SEMVER),
    channel: z.enum(APP_UPDATE_CHANNELS),
    publishedAt: z.string().datetime(),
    notes: AppReleaseNotesSchema,
    artifacts: z.array(AppReleaseArtifactSchema).max(200),
    stores: z.array(AppReleaseStoreSchema).max(50).default([]),
    /** Earlier versions of this repo that must never be offered again (wiki §3.1) */
    yanked: z.array(z.string().regex(APP_CONFIG_SEMVER)).max(200).default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    // The tag says what the release is: its version, and an admin- tag ships only the Admin app
    const tag = parseAppReleaseTag(m.tag);
    if (!tag) ctx.addIssue({ code: 'custom', path: ['tag'], message: 'not a release tag' });
    else {
      if (!APP_CONFIG_SEMVER.test(m.version) || compareAppVersions(tag.version, m.version) !== 0) ctx.addIssue({ code: 'custom', path: ['version'], message: `must be the tag's version ${tag.version}` });
      if (tag.adminOnly) {
        [...m.artifacts, ...m.stores].forEach((x, i) => {
          if (x.app !== 'admin') ctx.addIssue({ code: 'custom', path: ['artifacts', i, 'app'], message: 'an admin- tag releases only the Admin app' });
        });
      }
    }
    // Every file comes from this repo's release for this tag, over HTTPS: a manifest can never
    // point an app at another host, another repo or another release.
    const prefix = appReleaseDownloadPrefix(m.repo, m.tag);
    m.artifacts.forEach((a, i) => {
      if (!a.url.startsWith(prefix)) ctx.addIssue({ code: 'custom', path: ['artifacts', i, 'url'], message: `must start with ${prefix}` });
    });
  });
export type AppReleaseManifest = z.infer<typeof AppReleaseManifestSchema>;

const KEY_ID = /^[0-9a-f]{8}$/;
const PUBLIC_KEY = /^[A-Za-z0-9+/]{43}=$/;

/**
 * `app-release.json.sig` and `update-keys.json.sig`: one signature normally, two while a key is
 * being replaced (wiki §3.1, §3.5).
 */
export const AppReleaseSignatureSchema = z
  .object({
    signatures: z
      .array(z.object({ keyId: z.string().regex(KEY_ID), sig: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict())
      .min(1)
      .max(4),
  })
  .strict();
export type AppReleaseSignature = z.infer<typeof AppReleaseSignatureSchema>;

/** `update-keys.json`, signed by the repo's offline root key (wiki §3.5). */
export const AppUpdateKeyListSchema = z
  .object({
    schema: z.literal(1),
    repo: z.enum(APP_RELEASE_REPOS),
    serial: z.number().int().min(1).max(1_000_000),
    keys: z.array(z.object({ keyId: z.string().regex(KEY_ID), publicKey: z.string().regex(PUBLIC_KEY) }).strict()).min(1).max(4),
    revoked: z.array(z.string().regex(KEY_ID)).max(100).default([]),
    yanked: z.array(z.string().regex(APP_CONFIG_SEMVER)).max(200).default([]),
  })
  .strict();
export type AppUpdateKeyList = z.infer<typeof AppUpdateKeyListSchema>;

export function appReleaseDownloadPrefix(repo: string, tag: string): string {
  return `https://github.com/Al-Ummah-Now/${repo}/releases/download/${tag}/`;
}

/** The release keys a verifier trusts for one repo, and what it has learned to refuse. */
export interface AppReleaseTrust {
  /** base64 raw 32-byte ed25519 public keys */
  keys: readonly string[];
  /** key ids never to trust again, even if listed in `keys` */
  revoked?: readonly string[];
  /** versions never to accept */
  yanked?: readonly string[];
}

export type AppReleaseVerifyFailure =
  | 'too_large'
  | 'bad_signature_file'
  | 'unknown_key'
  | 'bad_signature'
  | 'bad_json'
  | 'bad_manifest'
  | 'wrong_repo'
  | 'wrong_tag'
  | 'wrong_channel'
  | 'not_newer'
  | 'below_floor'
  | 'yanked';

export type AppReleaseVerifyResult = { ok: true; manifest: AppReleaseManifest; keyId: string } | { ok: false; reason: AppReleaseVerifyFailure; detail?: string };

export interface AppReleaseVerifyExpect {
  /** The repo the manifest was fetched from. */
  repo: AppReleaseRepo;
  /** The tag the API (or the feed) named. */
  tag?: string;
  /** Channels this build accepts: a beta build takes beta and stable. */
  channels?: readonly AppUpdateChannel[];
  /** Refuse a manifest whose version is not above this one (the installed build): no downgrade. */
  newerThan?: string;
  /** Refuse a manifest below this version (the highest this app has ever verified): no replay of superseded releases. */
  floor?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A key's id: the first 8 hex characters of SHA-256 over the raw 32-byte public key. */
export async function appReleaseKeyId(publicKeyBase64: string): Promise<string> {
  const raw = base64ToBytes(publicKeyBase64);
  return toHex(await crypto.subtle.digest('SHA-256', raw as BufferSource)).slice(0, 8);
}

type SignatureCheck = { ok: true; keyId: string } | { ok: false; reason: 'too_large' | 'bad_signature_file' | 'unknown_key' | 'bad_signature' };

/** Any one signature valid under a trusted, non-revoked key passes. */
async function checkSignatures(bytes: Uint8Array, signatureText: string, keys: readonly string[], revoked: readonly string[]): Promise<SignatureCheck> {
  if (bytes.byteLength > APP_RELEASE_MANIFEST_MAX_BYTES) return { ok: false, reason: 'too_large' };
  let file: AppReleaseSignature;
  try {
    const parsed = AppReleaseSignatureSchema.safeParse(JSON.parse(signatureText));
    if (!parsed.success) return { ok: false, reason: 'bad_signature_file' };
    file = parsed.data;
  } catch {
    return { ok: false, reason: 'bad_signature_file' };
  }
  const byId = new Map<string, string>();
  for (const k of keys) {
    const id = await appReleaseKeyId(k);
    if (!revoked.includes(id)) byId.set(id, k);
  }
  let candidate = false;
  for (const s of file.signatures) {
    const key = byId.get(s.keyId);
    if (!key) continue;
    candidate = true;
    try {
      const pub = await crypto.subtle.importKey('raw', base64ToBytes(key) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'Ed25519' }, pub, base64ToBytes(s.sig) as BufferSource, bytes as BufferSource)) return { ok: true, keyId: s.keyId };
    } catch {
      // a malformed key or signature is simply not a valid signature
    }
  }
  return { ok: false, reason: candidate ? 'bad_signature' : 'unknown_key' };
}

function parseJson(bytes: Uint8Array): { ok: true; json: unknown } | { ok: false } {
  try {
    return { ok: true, json: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

const issuesText = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
  issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join('.')}: ${i.message}`)
    .join('; ');

/**
 * Checks a release manifest: a valid signature under a trusted, non-revoked key first (nothing in
 * an unsigned or tampered file is parsed or trusted), then its contents, repo, tag, channel, and
 * the no-downgrade, floor and yanked rules (wiki §5.3).
 */
export async function verifyAppReleaseManifest(manifestBytes: Uint8Array, signatureText: string, trust: AppReleaseTrust, expect: AppReleaseVerifyExpect): Promise<AppReleaseVerifyResult> {
  const sig = await checkSignatures(manifestBytes, signatureText, trust.keys, trust.revoked ?? []);
  if (sig.ok === false) return { ok: false, reason: (sig as Extract<SignatureCheck, { ok: false }>).reason };
  const json = parseJson(manifestBytes);
  if (json.ok === false) return { ok: false, reason: 'bad_json' };
  const parsed = AppReleaseManifestSchema.safeParse((json as { json: unknown }).json);
  if (!parsed.success) return { ok: false, reason: 'bad_manifest', detail: issuesText(parsed.error.issues) };
  const m = parsed.data;
  if (m.repo !== expect.repo) return { ok: false, reason: 'wrong_repo' };
  if (expect.tag !== undefined && m.tag !== expect.tag) return { ok: false, reason: 'wrong_tag' };
  if (expect.channels !== undefined && !expect.channels.includes(m.channel)) return { ok: false, reason: 'wrong_channel' };
  if (expect.newerThan !== undefined && compareAppVersions(m.version, expect.newerThan) <= 0) return { ok: false, reason: 'not_newer' };
  if (expect.floor !== undefined && compareAppVersions(m.version, expect.floor) < 0) return { ok: false, reason: 'below_floor' };
  if ((trust.yanked ?? []).some((v) => compareAppVersions(v, m.version) === 0)) return { ok: false, reason: 'yanked' };
  return { ok: true, manifest: m, keyId: (sig as { keyId: string }).keyId };
}

export type AppKeyListVerifyFailure = 'too_large' | 'bad_signature_file' | 'unknown_key' | 'bad_signature' | 'bad_json' | 'bad_list' | 'wrong_repo' | 'not_newer';
export type AppKeyListVerifyResult = { ok: true; list: AppUpdateKeyList } | { ok: false; reason: AppKeyListVerifyFailure; detail?: string };

/**
 * Checks a key list against the repo's root public keys. Accepted only with a serial above the one
 * already stored, so an old list (with a key since revoked) can't be replayed (wiki §3.5).
 */
export async function verifyAppUpdateKeyList(
  listBytes: Uint8Array,
  signatureText: string,
  rootKeys: readonly string[],
  expect: { repo: AppReleaseRepo; storedSerial?: number },
): Promise<AppKeyListVerifyResult> {
  const sig = await checkSignatures(listBytes, signatureText, rootKeys, []);
  if (sig.ok === false) return { ok: false, reason: (sig as Extract<SignatureCheck, { ok: false }>).reason };
  const json = parseJson(listBytes);
  if (json.ok === false) return { ok: false, reason: 'bad_json' };
  const parsed = AppUpdateKeyListSchema.safeParse((json as { json: unknown }).json);
  if (!parsed.success) return { ok: false, reason: 'bad_list', detail: issuesText(parsed.error.issues) };
  const list = parsed.data;
  for (const k of list.keys) {
    if ((await appReleaseKeyId(k.publicKey)) !== k.keyId) return { ok: false, reason: 'bad_list', detail: `keyId ${k.keyId} does not match its key` };
  }
  if (list.repo !== expect.repo) return { ok: false, reason: 'wrong_repo' };
  if (expect.storedSerial !== undefined && list.serial <= expect.storedSerial) return { ok: false, reason: 'not_newer' };
  return { ok: true, list };
}

/**
 * What a verifier trusts after accepting a key list: its keys minus every key ever revoked (the
 * new list's and the ones remembered from earlier lists), and every version ever yanked.
 */
export function appReleaseTrustFrom(list: AppUpdateKeyList, remembered: { revoked?: readonly string[]; yanked?: readonly string[] } = {}): AppReleaseTrust & { revoked: string[]; yanked: string[] } {
  const revoked = [...new Set([...(remembered.revoked ?? []), ...list.revoked])];
  const yanked = [...new Set([...(remembered.yanked ?? []), ...list.yanked])];
  return { keys: list.keys.filter((k) => !revoked.includes(k.keyId)).map((k) => k.publicKey), revoked, yanked };
}
