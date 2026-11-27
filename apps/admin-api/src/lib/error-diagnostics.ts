/**
 * Opt-in scrubbed diagnostic log bundles stored in R2 (bucket DIAGNOSTICS, 30-day R2 lifecycle
 * expiry) and indexed in REPORTS_DB.error_diagnostics by error reference (ERR-XXXX-XXXX).
 */
import { newErrorRef, parseErrorRef, type ErrorApp } from '@al-ummah/shared-types';
import type { D1Database } from './types';

/** Maximum accepted diagnostic body size (UTF-8 bytes, before server-side gzip). */
export const DIAGNOSTIC_MAX_BYTES = 512 * 1024;
export const DIAGNOSTIC_RETENTION_DAYS = 30;

export interface DiagnosticBucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string; contentEncoding?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface ErrorDiagnosticRow {
  ref: string;
  app: string;
  environment: string;
  r2_key: string;
  content_encoding: string;
  size_bytes: number;
  stored_bytes: number;
  entry_count: number;
  release: string | null;
  user_id: string | null;
  created_at: string;
}

export interface StoreDiagnosticInput {
  ref?: string | null;
  app: ErrorApp;
  environment: string;
  release?: string | null;
  userId?: string | null;
  entryCount?: number;
  content: string;
  now?: Date;
}

export interface StoredDiagnostic {
  ref: string;
  r2Key: string;
  sizeBytes: number;
  storedBytes: number;
  entryCount: number;
  createdAt: string;
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const HEADER_SECRET_RE = /\b((?:x-api-key|x-internal-api-key|authorization)\s*[:=]\s*)[^\s,;]+/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const QUERY_SECRET_RE = /([?&](?:token|access_token|refresh_token|key|api_key|apikey|sig|signature|auth|secret|password|x-amz-signature|x-amz-credential|x-amz-security-token)=)[^&\s"']+/gi;
const API_KEY_RE = /\b(?:re|sk|pk|ghp|gho|ghu|ghs)_[A-Za-z0-9_-]{12,}\b/g;
const WIN_HOME_RE = /\b[A-Za-z]:\\Users\\[^\\\s"']+/gi;
const UNIX_HOME_RE = /(?:\/Users|\/home)\/[^/\s"']+/g;
const UNC_HOST_RE = /\\\\([^\\\s"']+)\\([^\\\s"']+)/g;

/** Defense-in-depth server-side scrubber for diagnostic log text. */
export function scrubDiagnosticContent(raw: string): string {
  return raw
    .replace(BEARER_RE, 'Bearer [redacted]')
    .replace(HEADER_SECRET_RE, '$1[redacted]')
    .replace(JWT_RE, '[jwt]')
    .replace(QUERY_SECRET_RE, '$1[redacted]')
    .replace(API_KEY_RE, '[key]')
    .replace(EMAIL_RE, '[email]')
    .replace(WIN_HOME_RE, '[user-home]')
    .replace(UNIX_HOME_RE, '[user-home]')
    .replace(UNC_HOST_RE, '\\\\[share]\\$2');
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function compressDiagnostic(text: string): Promise<{ bytes: Uint8Array; encoding: 'gzip' | 'identity' }> {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return { bytes: raw, encoding: 'identity' };
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  await writer.write(raw);
  await writer.close();
  return { bytes: await readStreamBytes(cs.readable), encoding: 'gzip' };
}

export async function decompressDiagnostic(bytes: Uint8Array, encoding: string): Promise<string> {
  if (encoding !== 'gzip' || typeof DecompressionStream === 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new TextDecoder().decode(await readStreamBytes(ds.readable));
}

function safeSegment(value: string, fallback: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return clean.slice(0, 32) || fallback;
}

export async function storeErrorDiagnostic(db: D1Database, bucket: DiagnosticBucket, input: StoreDiagnosticInput): Promise<StoredDiagnostic> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const day = createdAt.slice(0, 10);
  const ref = (input.ref ? parseErrorRef(input.ref) : null) ?? newErrorRef();
  const env = safeSegment(input.environment, 'unknown');
  const app = safeSegment(input.app, 'tools');
  const scrubbed = scrubDiagnosticContent(input.content);
  const sizeBytes = new TextEncoder().encode(scrubbed).byteLength;
  const { bytes, encoding } = await compressDiagnostic(scrubbed);
  const storedBytes = bytes.byteLength;
  const entryCount = typeof input.entryCount === 'number' && Number.isFinite(input.entryCount) ? Math.max(0, Math.min(100_000, Math.floor(input.entryCount))) : 0;
  const release = input.release ? input.release.trim().slice(0, 80) || null : null;
  const userId = input.userId && /^usr_[A-Za-z0-9_-]+$/.test(input.userId) ? input.userId : null;
  const r2Key = `diag/${env}/${app}/${day}/${ref}.log${encoding === 'gzip' ? '.gz' : ''}`;

  await bucket.put(r2Key, bytes, {
    httpMetadata: { contentType: 'text/plain; charset=utf-8', ...(encoding === 'gzip' ? { contentEncoding: 'gzip' } : {}) },
    customMetadata: { ref, app, environment: env, sizeBytes: String(sizeBytes) },
  });

  await db
    .prepare(
      `INSERT INTO error_diagnostics (ref, app, environment, r2_key, content_encoding, size_bytes, stored_bytes, entry_count, release, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ref) DO UPDATE SET
         app = excluded.app,
         environment = excluded.environment,
         r2_key = excluded.r2_key,
         content_encoding = excluded.content_encoding,
         size_bytes = excluded.size_bytes,
         stored_bytes = excluded.stored_bytes,
         entry_count = excluded.entry_count,
         release = excluded.release,
         user_id = excluded.user_id,
         created_at = excluded.created_at`,
    )
    .bind(ref, app, env, r2Key, encoding, sizeBytes, storedBytes, entryCount, release, userId, createdAt)
    .run();

  return { ref, r2Key, sizeBytes, storedBytes, entryCount, createdAt };
}

export async function getErrorDiagnosticMeta(db: D1Database, ref: string): Promise<ErrorDiagnosticRow | null> {
  return db.prepare('SELECT * FROM error_diagnostics WHERE ref = ?').bind(ref).first<ErrorDiagnosticRow>();
}

export async function readErrorDiagnostic(db: D1Database, bucket: DiagnosticBucket, ref: string): Promise<{ meta: ErrorDiagnosticRow; content: string } | null> {
  const meta = await getErrorDiagnosticMeta(db, ref);
  if (!meta) return null;
  const obj = await bucket.get(meta.r2_key);
  if (!obj) return null;
  const buf = new Uint8Array(await obj.arrayBuffer());
  const content = await decompressDiagnostic(buf, meta.content_encoding);
  return { meta, content };
}
