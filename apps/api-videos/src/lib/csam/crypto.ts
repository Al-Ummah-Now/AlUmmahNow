/**
 * Encryption at rest for CSAM evidence (docs/specs/CSAM-RESPONSE.md §4; 18 U.S.C. § 2258A(h)(3):
 * a secure location with limited access).
 *
 * AES-256-GCM, chunked so a multi-GB original never sits in memory: each plaintext chunk
 * (CHUNK_BYTES, the last one shorter) becomes `iv (12) ‖ ciphertext ‖ tag (16)` with a random IV.
 * The additional data binds every chunk to its case, file and position, so chunks cannot be
 * swapped, reordered or moved to another case without failing to decrypt.
 *
 * Key: CSAM_EVIDENCE_KEY, `<version>:<base64 32 bytes>[,<version>:<base64>…]`. New evidence uses
 * the highest version; older versions stay readable after a rotation.
 */
import { getSecret } from '../env-helpers';

export const CHUNK_BYTES = 8 * 1024 * 1024;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const SEALED_CHUNK_BYTES = CHUNK_BYTES + IV_BYTES + TAG_BYTES;

export interface EvidenceKeys {
  current: { version: number; key: CryptoKey };
  byVersion: Map<number, CryptoKey>;
}

export class EvidenceKeyError extends Error {}

const b64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Parses the key secret (pure apart from importKey). Throws when it is missing or malformed. */
export async function parseEvidenceKeys(secret: string | null | undefined): Promise<EvidenceKeys> {
  const byVersion = new Map<number, CryptoKey>();
  for (const entry of (secret ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = /^(\d{1,4}):([A-Za-z0-9+/=]+)$/.exec(entry);
    if (!match) throw new EvidenceKeyError('CSAM_EVIDENCE_KEY: entries are <version>:<base64>');
    const raw = b64(match[2]!);
    if (raw.byteLength !== 32) throw new EvidenceKeyError('CSAM_EVIDENCE_KEY: each key is 32 bytes');
    byVersion.set(Number(match[1]), await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
  }
  if (!byVersion.size) throw new EvidenceKeyError('CSAM_EVIDENCE_KEY is not configured');
  const version = Math.max(...byVersion.keys());
  return { current: { version, key: byVersion.get(version)! }, byVersion };
}

export async function evidenceKeys(env: { CSAM_EVIDENCE_KEY?: unknown }): Promise<EvidenceKeys> {
  const secret = env.CSAM_EVIDENCE_KEY ? await getSecret(env.CSAM_EVIDENCE_KEY, 'CSAM_EVIDENCE_KEY').catch(() => '') : '';
  return parseEvidenceKeys(secret);
}

const aad = (caseId: string, name: string, index: number) => new TextEncoder().encode(`csam/${caseId}/${name}/${index}`);

export async function sealChunk(key: CryptoKey, plain: Uint8Array, at: { caseId: string; name: string; index: number }): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(at.caseId, at.name, at.index) }, key, plain));
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv, 0);
  out.set(sealed, IV_BYTES);
  return out;
}

export async function openChunk(key: CryptoKey, sealed: Uint8Array, at: { caseId: string; name: string; index: number }): Promise<Uint8Array> {
  if (sealed.byteLength < IV_BYTES + TAG_BYTES) throw new Error('sealed chunk too short');
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, IV_BYTES), additionalData: aad(at.caseId, at.name, at.index) }, key, sealed.subarray(IV_BYTES)),
  );
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A small document (the manifest, a record snapshot) as one sealed chunk. */
export async function sealJson(key: CryptoKey, value: unknown, at: { caseId: string; name: string }): Promise<Uint8Array> {
  return sealChunk(key, new TextEncoder().encode(JSON.stringify(value)), { ...at, index: 0 });
}

export async function openJson<T>(key: CryptoKey, sealed: Uint8Array, at: { caseId: string; name: string }): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await openChunk(key, sealed, { ...at, index: 0 }))) as T;
}
