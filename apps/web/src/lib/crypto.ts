/**
 * Client-side encryption primitives (Story 1.3, AC 1)
 *
 * Design: a per-device, non-extractable AES-GCM-256 key.
 *
 * - The key is generated in the browser with WebCrypto (`extractable: false`)
 *   the first time it is needed and persisted in IndexedDB. IndexedDB stores the
 *   CryptoKey object itself (structured clone), so the raw key bytes are never
 *   exposed to JavaScript and cannot be read out of the storage files or copied
 *   to another device.
 * - No secret is shipped in the JavaScript bundle. The previous design derived
 *   the key from NEXT_PUBLIC_ENCRYPTION_SECRET, which is public by definition,
 *   was not set in builds, and used a fresh random salt per page load so data
 *   could not be decrypted after a reload.
 * - AES-GCM is authenticated encryption: tampering with the ciphertext, IV or
 *   associated data makes decryption fail, so no separate HMAC is needed.
 * - Each value is bound to its storage key via GCM additional authenticated
 *   data, so ciphertexts cannot be swapped between keys.
 * - Deleting the key (clearDeviceKey) crypto-shreds everything encrypted with it.
 *
 * Threat model: protects data at rest in localStorage against disk/profile
 * copying, backup leaks, other local software and casual inspection. It cannot
 * protect against script running on our own origin (XSS); that is what the CSP
 * and listener validation from Story 1.2 address.
 */

import { logger } from '@/lib/logger-client';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const DB_NAME = 'aun-secure-store';
const STORE_NAME = 'keys';
const DEVICE_KEY_ID = 'device-key-v1';

export class EncryptionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/** Persistence for the device CryptoKey. IndexedDB in browsers; injectable for tests. */
export interface KeyStore {
  get(id: string): Promise<CryptoKey | undefined>;
  put(id: string, key: CryptoKey): Promise<void>;
  delete(id: string): Promise<void>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IndexedDbKeyStore implements KeyStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this.dbPromise = null;
          reject(request.error);
        };
      });
    }
    return this.dbPromise;
  }

  async get(id: string): Promise<CryptoKey | undefined> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return requestToPromise(tx.objectStore(STORE_NAME).get(id) as IDBRequest<CryptoKey | undefined>);
  }

  async put(id: string, key: CryptoKey): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).put(key, id));
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).delete(id));
  }
}

let keyStore: KeyStore | null = null;
let cachedKey: Promise<CryptoKey> | null = null;

/** Replace the key store (tests, or environments without IndexedDB). */
export function setKeyStore(store: KeyStore | null): void {
  keyStore = store;
  cachedKey = null;
}

function getKeyStore(): KeyStore | null {
  if (keyStore) return keyStore;
  if (typeof indexedDB === 'undefined') return null;
  keyStore = new IndexedDbKeyStore();
  return keyStore;
}

/** True when WebCrypto and a key store are available, i.e. encrypted storage can work. */
export function isEncryptionAvailable(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle?.encrypt === 'function' &&
    typeof crypto.getRandomValues === 'function' &&
    getKeyStore() !== null
  );
}

async function loadOrCreateDeviceKey(): Promise<CryptoKey> {
  const store = getKeyStore();
  if (!store || !isEncryptionAvailable()) {
    throw new EncryptionError('Encryption is not available in this browser');
  }
  const existing = await store.get(DEVICE_KEY_ID);
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
  await store.put(DEVICE_KEY_ID, key);
  // Re-read so concurrent tabs converge on whichever key was persisted last.
  const persisted = await store.get(DEVICE_KEY_ID);
  logger.debug('[Crypto] Generated new device encryption key');
  return persisted ?? key;
}

async function getDeviceKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = loadOrCreateDeviceKey().catch(error => {
      cachedKey = null;
      throw error instanceof EncryptionError ? error : new EncryptionError('Failed to load device key', error);
    });
  }
  return cachedKey;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface Ciphertext {
  iv: string;
  ct: string;
}

/** Encrypt a string with the device key. `context` is bound as associated data. */
export async function encryptString(plaintext: string, context: string): Promise<Ciphertext> {
  const key = await getDeviceKey();
  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv, additionalData: new TextEncoder().encode(context) },
      key,
      new TextEncoder().encode(plaintext),
    );
    return { iv: toBase64(iv), ct: toBase64(new Uint8Array(encrypted)) };
  } catch (error) {
    throw new EncryptionError('Failed to encrypt data', error);
  }
}

/** Decrypt a value produced by encryptString with the same context. */
export async function decryptString(ciphertext: Ciphertext, context: string): Promise<string> {
  const key = await getDeviceKey();
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: fromBase64(ciphertext.iv) as BufferSource, additionalData: new TextEncoder().encode(context) },
      key,
      fromBase64(ciphertext.ct) as BufferSource,
    );
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new EncryptionError('Failed to decrypt data', error);
  }
}

/**
 * Delete the device key. Everything encrypted with it becomes unreadable
 * (crypto-shredding); used by "clear my data on this device".
 */
export async function clearDeviceKey(): Promise<void> {
  cachedKey = null;
  const store = getKeyStore();
  if (!store) return;
  try {
    await store.delete(DEVICE_KEY_ID);
  } catch (error) {
    logger.warn('[Crypto] Failed to delete device key', { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Drop the in-memory key handle (e.g. on logout); the persisted key is kept. */
export function clearEncryptionCache(): void {
  cachedKey = null;
}
