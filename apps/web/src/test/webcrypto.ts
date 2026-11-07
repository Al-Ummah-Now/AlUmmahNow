/**
 * Test helpers: Node's WebCrypto in jsdom and an in-memory KeyStore that
 * behaves like IndexedDB (stores the CryptoKey object, never its bytes).
 */
import { webcrypto } from 'crypto';
import { TextDecoder, TextEncoder } from 'util';
import type { KeyStore } from '@/lib/crypto';

export function installWebCrypto(): void {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  if (typeof globalThis.TextEncoder === 'undefined') {
    Object.assign(globalThis, { TextEncoder, TextDecoder });
  }
}

export class MemoryKeyStore implements KeyStore {
  keys = new Map<string, CryptoKey>();
  async get(id: string) {
    return this.keys.get(id);
  }
  async put(id: string, key: CryptoKey) {
    this.keys.set(id, key);
  }
  async delete(id: string) {
    this.keys.delete(id);
  }
}
