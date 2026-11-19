/**
 * The read-only Cloudflare API token of the transcode troubleshooting panel (videos admin →
 * Delivery), set by a super admin in the admin. Same pattern as the Costs page's connections
 * (COST-1, #1400): sealed at rest, never returned, last 4 shown, Test, every change audited.
 *
 * - AES-256-GCM, random 12-byte IV per value, additional data = the setting key. The AES key is
 *   HKDF-SHA256 of INTERNAL_API_KEY with a fixed salt and info of its own, so it is never stored
 *   and differs from the internal key itself. A token that no longer opens (the internal key was
 *   rotated) reads as "set it again", never as an error.
 * - Stored in site_settings under SETTING_KEY (read per key only; no route lists site_settings).
 * - Audited in site_settings_log under AUDIT_KEY with the last 4 characters only.
 */
import type { TroubleshootTokenCheck, TroubleshootTokenView } from '@al-ummah/shared-types';
import type { D1Database } from '../types';
import { auditOriginJson } from '../request-origin';

export const SETTING_KEY = 'ops:cloudflare-troubleshoot-token';
export const AUDIT_KEY = 'media:troubleshoot-token';

const SALT = new TextEncoder().encode('al-ummah-ops-troubleshoot-token');
const INFO = new TextEncoder().encode('troubleshoot-token:aes-gcm:v1');
const AAD = new TextEncoder().encode(SETTING_KEY);

interface Stored {
  ciphertext: string;
  iv: string;
  last4: string;
  test?: TroubleshootTokenView['test'];
}

type SecretLike = string | { get(): Promise<string> } | undefined;

async function master(binding: SecretLike): Promise<string | null> {
  try {
    const value = typeof binding === 'string' ? binding : binding ? await binding.get() : '';
    return value && value.length >= 16 ? value : null;
  } catch {
    return null;
  }
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export class TokenError extends Error {}

/** Basic shape check before saving; returns an error code or null. The value is never echoed. */
export function tokenProblem(value: unknown): 'not_text' | 'bad_shape' | null {
  if (typeof value !== 'string') return 'not_text';
  const v = value.trim();
  if (v.length < 20 || v.length > 400 || /\s/.test(v)) return 'bad_shape';
  return null;
}

export const last4Of = (value: string) => {
  const v = value.trim();
  return v.length >= 12 ? v.slice(-4) : '';
};

export async function seal(value: string, internalKey: SecretLike): Promise<Stored> {
  const secret = await master(internalKey);
  if (!secret) throw new TokenError('No key to encrypt the token with (INTERNAL_API_KEY is not bound)');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await aesKey(secret), new TextEncoder().encode(value.trim()));
  return { ciphertext: toB64(new Uint8Array(sealed)), iv: toB64(iv), last4: last4Of(value) };
}

/** The token, or null when it cannot be opened (no master, rotated master, tampered row). */
export async function open(stored: Pick<Stored, 'ciphertext' | 'iv'>, internalKey: SecretLike): Promise<string | null> {
  const secret = await master(internalKey);
  if (!secret) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(stored.iv), additionalData: AAD }, await aesKey(secret), fromB64(stored.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

interface Row {
  value: string;
  updated_by: string;
  updated_at: string;
}

async function readRow(db: D1Database): Promise<(Stored & { updatedBy: string; updatedAt: string }) | null> {
  const row = await db.prepare('SELECT value, updated_by, updated_at FROM site_settings WHERE key = ?').bind(SETTING_KEY).first<Row>();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Stored;
    if (typeof parsed.ciphertext !== 'string' || typeof parsed.iv !== 'string') return null;
    return { ...parsed, updatedBy: row.updated_by, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

/** What the admin sees (never the value) and, for the server, the opened token. */
export async function readToken(db: D1Database, internalKey: SecretLike): Promise<{ view: TroubleshootTokenView; token: string | null }> {
  const row = await readRow(db);
  if (!row) return { view: { set: false, last4: null, updatedBy: null, updatedAt: null, test: null }, token: null };
  const token = await open(row, internalKey);
  return {
    view: { set: true, last4: row.last4 || null, updatedBy: row.updatedBy, updatedAt: row.updatedAt, test: row.test ?? null, ...(token === null ? { unreadable: true } : {}) },
    token,
  };
}

async function writeRow(db: D1Database, stored: Stored, actorId: string, updatedBy: string, now: string, audit: Record<string, unknown>, oldAudit: Record<string, unknown> | null): Promise<void> {
  await db.batch([
    db
      .prepare('INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
      .bind(SETTING_KEY, JSON.stringify(stored), updatedBy, now),
    db
      .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), AUDIT_KEY, oldAudit ? JSON.stringify(oldAudit) : null, JSON.stringify(audit), actorId, now, auditOriginJson()),
  ]);
}

/**
 * Seals and stores a token (replacing any), with its test result; audited by last 4 only. `updatedBy`
 * is what the card shows (the admin's email); the audit row keeps the user id.
 */
export async function saveToken(
  db: D1Database,
  internalKey: SecretLike,
  value: string,
  actorId: string,
  test: { ok: boolean; checks: { name: TroubleshootTokenCheck; ok: boolean }[] },
  now = new Date(),
  updatedBy = actorId,
): Promise<TroubleshootTokenView> {
  const before = await readRow(db);
  const at = now.toISOString();
  const stored: Stored = { ...(await seal(value, internalKey)), test: { ...test, at } };
  await writeRow(db, stored, actorId, updatedBy, at, { action: before ? 'replaced' : 'set', last4: stored.last4, test: test.ok }, before ? { last4: before.last4 } : null);
  return (await readToken(db, internalKey)).view;
}

/** Stores a new test result of the current token (who set it and when stay); audited with who tested. */
export async function storeTest(db: D1Database, actorId: string, test: { ok: boolean; checks: { name: TroubleshootTokenCheck; ok: boolean }[] }, now = new Date()): Promise<void> {
  const row = await readRow(db);
  if (!row) return;
  const at = now.toISOString();
  const stored: Stored = { ciphertext: row.ciphertext, iv: row.iv, last4: row.last4, test: { ...test, at } };
  await db.batch([
    db.prepare('UPDATE site_settings SET value = ? WHERE key = ?').bind(JSON.stringify(stored), SETTING_KEY),
    db
      .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), AUDIT_KEY, null, JSON.stringify({ action: 'tested', last4: row.last4, ok: test.ok }), actorId, at, auditOriginJson()),
  ]);
}

/** Removes the token; audited. */
export async function removeToken(db: D1Database, actorId: string, now = new Date()): Promise<boolean> {
  const row = await readRow(db);
  if (!row) return false;
  const at = now.toISOString();
  await db.batch([
    db.prepare('DELETE FROM site_settings WHERE key = ?').bind(SETTING_KEY),
    db
      .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), AUDIT_KEY, JSON.stringify({ last4: row.last4 }), JSON.stringify({ action: 'removed' }), actorId, at, auditOriginJson()),
  ]);
  return true;
}
