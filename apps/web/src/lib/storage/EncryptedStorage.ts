/**
 * EncryptedStorage (Story 1.3, AC 1, 5)
 *
 * localStorage wrapper for sensitive values (e.g. anonymous watch progress,
 * which reveals viewing habits and, on a religious-content platform, potentially
 * religious beliefs: GDPR Art. 9 special-category data).
 *
 * - Values are AES-GCM encrypted with the per-device non-extractable key from
 *   lib/crypto.ts; the storage key is bound as associated data.
 * - Every entry carries an expiry (`exp`, plaintext in the envelope) so the
 *   retention sweeper can purge expired entries without decrypting them.
 * - If encryption is unavailable (no WebCrypto / IndexedDB, e.g. some private
 *   browsing modes) values are kept in memory for the session only and never
 *   written to disk in plaintext.
 */

import { logger } from '@/lib/logger-client';
import { decryptString, encryptString, clearDeviceKey, isEncryptionAvailable } from '@/lib/crypto';

export const ENCRYPTED_KEY_PREFIX = 'aun.enc.';
const ENVELOPE_VERSION = 1;

interface Envelope {
  v: number;
  iv: string;
  ct: string;
  /** Expiry as epoch milliseconds. */
  exp: number;
}

export interface EncryptedSetOptions {
  /** Time to live in milliseconds. Required: nothing sensitive is stored forever. */
  ttlMs: number;
}

const memoryFallback = new Map<string, { value: string; exp: number }>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function fullKey(key: string): string {
  return ENCRYPTED_KEY_PREFIX + key;
}

function context(key: string): string {
  return `aun:${fullKey(key)}:v${ENVELOPE_VERSION}`;
}

function parseEnvelope(raw: string | null): Envelope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Envelope>;
    if (
      parsed.v === ENVELOPE_VERSION &&
      typeof parsed.iv === 'string' &&
      typeof parsed.ct === 'string' &&
      typeof parsed.exp === 'number'
    ) {
      return parsed as Envelope;
    }
  } catch {
    // fall through
  }
  return null;
}

export const EncryptedStorage = {
  async setItem<T>(key: string, value: T, options: EncryptedSetOptions): Promise<boolean> {
    const exp = Date.now() + Math.max(0, options.ttlMs);
    const json = JSON.stringify(value);
    const store = storage();
    if (!store || !isEncryptionAvailable()) {
      memoryFallback.set(key, { value: json, exp });
      return true;
    }
    try {
      const { iv, ct } = await encryptString(json, context(key));
      const envelope: Envelope = { v: ENVELOPE_VERSION, iv, ct, exp };
      store.setItem(fullKey(key), JSON.stringify(envelope));
      return true;
    } catch (error) {
      logger.warn('[EncryptedStorage] Failed to store value; keeping it in memory only', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      memoryFallback.set(key, { value: json, exp });
      return false;
    }
  },

  async getItem<T>(key: string): Promise<T | null> {
    const now = Date.now();
    const memory = memoryFallback.get(key);
    if (memory) {
      if (memory.exp <= now) {
        memoryFallback.delete(key);
      } else {
        return JSON.parse(memory.value) as T;
      }
    }

    const store = storage();
    if (!store) return null;
    const raw = store.getItem(fullKey(key));
    if (raw === null) return null;
    const envelope = parseEnvelope(raw);
    if (!envelope || envelope.exp <= now) {
      store.removeItem(fullKey(key));
      return null;
    }
    try {
      const json = await decryptString({ iv: envelope.iv, ct: envelope.ct }, context(key));
      return JSON.parse(json) as T;
    } catch (error) {
      // Tampered data, or the device key was cleared: the value is unrecoverable.
      logger.warn('[EncryptedStorage] Discarding undecryptable value', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      store.removeItem(fullKey(key));
      return null;
    }
  },

  removeItem(key: string): void {
    memoryFallback.delete(key);
    storage()?.removeItem(fullKey(key));
  },

  /** Remove expired encrypted entries without decrypting them. Returns the number removed. */
  purgeExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of memoryFallback) {
      if (entry.exp <= now) {
        memoryFallback.delete(key);
        removed++;
      }
    }
    const store = storage();
    if (!store) return removed;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(ENCRYPTED_KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      const envelope = parseEnvelope(store.getItem(k));
      if (!envelope || envelope.exp <= now) {
        store.removeItem(k);
        removed++;
      }
    }
    return removed;
  },

  /** Remove every encrypted entry and shred the device key. */
  async clearAll(): Promise<void> {
    memoryFallback.clear();
    const store = storage();
    if (store) {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(ENCRYPTED_KEY_PREFIX)) keys.push(k);
      }
      keys.forEach(k => store.removeItem(k));
    }
    await clearDeviceKey();
  },
};

export default EncryptedStorage;
