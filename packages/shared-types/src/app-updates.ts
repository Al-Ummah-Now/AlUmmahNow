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
    tag: z.string().regex(/^v[0-9A-Za-z.+-]{1,64}$/),
    version: z.string().regex(APP_CONFIG_SEMVER),
    channel: z.enum(APP_UPDATE_CHANNELS),
    publishedAt: z.string().datetime(),
    notes: AppReleaseNotesSchema,
    artifacts: z.array(AppReleaseArtifactSchema).max(200),
    stores: z.array(AppReleaseStoreSchema).max(50).default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    // Every file comes from this repo's release for this tag, over HTTPS: a manifest can never
    // point an app at another host, another repo or another release.
    const prefix = appReleaseDownloadPrefix(m.repo, m.tag);
    m.artifacts.forEach((a, i) => {
      if (!a.url.startsWith(prefix)) ctx.addIssue({ code: 'custom', path: ['artifacts', i, 'url'], message: `must start with ${prefix}` });
    });
  });
export type AppReleaseManifest = z.infer<typeof AppReleaseManifestSchema>;

/** `app-release.json.sig` */
export const AppReleaseSignatureSchema = z
  .object({
    keyId: z.string().regex(/^[0-9a-f]{8}$/),
    sig: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export type AppReleaseSignature = z.infer<typeof AppReleaseSignatureSchema>;

export function appReleaseDownloadPrefix(repo: string, tag: string): string {
  return `https://github.com/Al-Ummah-Now/${repo}/releases/download/${tag}/`;
}

/** Public keys a verifier trusts: base64 of the raw 32-byte ed25519 key. One or two per repo (rotation). */
export type AppReleaseTrustedKeys = Partial<Record<AppReleaseRepo, readonly string[]>>;

export type AppReleaseVerifyFailure =
  | 'too_large'
  | 'bad_signature_file'
  | 'unknown_key'
  | 'bad_signature'
  | 'bad_json'
  | 'bad_manifest'
  | 'wrong_repo'
  | 'wrong_tag'
  | 'not_newer';

export type AppReleaseVerifyResult = { ok: true; manifest: AppReleaseManifest; keyId: string } | { ok: false; reason: AppReleaseVerifyFailure; detail?: string };

export interface AppReleaseVerifyExpect {
  /** The repo the manifest was fetched from. */
  repo: AppReleaseRepo;
  /** The tag it was fetched from, when known. */
  tag?: string;
  /** Refuse a manifest whose version is not above this one (no downgrades, no replays of older manifests). */
  newerThan?: string;
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

/**
 * Checks the ed25519 signature over the exact manifest bytes, then the manifest itself. The
 * signature is checked first, so nothing in an unsigned or tampered file is ever parsed or trusted.
 */
export async function verifyAppReleaseManifest(
  manifestBytes: Uint8Array,
  signatureText: string,
  trusted: AppReleaseTrustedKeys,
  expect: AppReleaseVerifyExpect,
): Promise<AppReleaseVerifyResult> {
  if (manifestBytes.byteLength > APP_RELEASE_MANIFEST_MAX_BYTES) return { ok: false, reason: 'too_large' };
  let sig: AppReleaseSignature;
  try {
    const parsed = AppReleaseSignatureSchema.safeParse(JSON.parse(signatureText));
    if (!parsed.success) return { ok: false, reason: 'bad_signature_file' };
    sig = parsed.data;
  } catch {
    return { ok: false, reason: 'bad_signature_file' };
  }
  let key: string | undefined;
  for (const k of trusted[expect.repo] ?? []) {
    if ((await appReleaseKeyId(k)) === sig.keyId) key = k;
  }
  if (!key) return { ok: false, reason: 'unknown_key' };
  let valid = false;
  try {
    const pub = await crypto.subtle.importKey('raw', base64ToBytes(key) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    valid = await crypto.subtle.verify({ name: 'Ed25519' }, pub, base64ToBytes(sig.sig) as BufferSource, manifestBytes as BufferSource);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  const parsed = AppReleaseManifestSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'bad_manifest', detail: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const manifest = parsed.data;
  if (manifest.repo !== expect.repo) return { ok: false, reason: 'wrong_repo' };
  if (expect.tag !== undefined && manifest.tag !== expect.tag) return { ok: false, reason: 'wrong_tag' };
  if (expect.newerThan !== undefined && compareAppVersions(manifest.version, expect.newerThan) <= 0) return { ok: false, reason: 'not_newer' };
  return { ok: true, manifest, keyId: sig.keyId };
}
