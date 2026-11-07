/**
 * Story 1.3 AC 1: per-device non-extractable AES-GCM key, no shipped secret.
 */
import { installWebCrypto, MemoryKeyStore } from '@/test/webcrypto';
import {
  clearDeviceKey,
  clearEncryptionCache,
  decryptString,
  encryptString,
  EncryptionError,
  isEncryptionAvailable,
  setKeyStore,
} from '../crypto';

describe('lib/crypto', () => {
  let store: MemoryKeyStore;

  beforeAll(() => installWebCrypto());

  beforeEach(() => {
    store = new MemoryKeyStore();
    setKeyStore(store);
  });

  it('does not depend on NEXT_PUBLIC_ENCRYPTION_SECRET', async () => {
    const previous = process.env.NEXT_PUBLIC_ENCRYPTION_SECRET;
    delete process.env.NEXT_PUBLIC_ENCRYPTION_SECRET;
    await expect(encryptString('x', 'ctx')).resolves.toBeDefined();
    process.env.NEXT_PUBLIC_ENCRYPTION_SECRET = previous;
  });

  it('generates a non-extractable AES-GCM-256 device key and persists it', async () => {
    expect(isEncryptionAvailable()).toBe(true);
    await encryptString('hello', 'ctx');
    const key = store.keys.get('device-key-v1')!;
    expect(key).toBeDefined();
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('round-trips and survives a "reload" (same persisted key)', async () => {
    const ct = await encryptString('{"videoId":"v1"}', 'aun:test');
    clearEncryptionCache(); // simulate a new page load: key comes back from the store
    await expect(decryptString(ct, 'aun:test')).resolves.toBe('{"videoId":"v1"}');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const a = await encryptString('same', 'ctx');
    const b = await encryptString('same', 'ctx');
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toContain('same');
  });

  it('detects tampering (authenticated encryption)', async () => {
    const ct = await encryptString('secret', 'ctx');
    const bytes = Uint8Array.from(atob(ct.ct), c => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    const tampered = { iv: ct.iv, ct: btoa(String.fromCharCode(...bytes)) };
    await expect(decryptString(tampered, 'ctx')).rejects.toThrow(EncryptionError);
  });

  it('binds ciphertext to its context (no swapping between keys)', async () => {
    const ct = await encryptString('secret', 'aun:a');
    await expect(decryptString(ct, 'aun:b')).rejects.toThrow(EncryptionError);
  });

  it('crypto-shreds data when the device key is cleared', async () => {
    const ct = await encryptString('secret', 'ctx');
    await clearDeviceKey();
    expect(store.keys.size).toBe(0);
    await expect(decryptString(ct, 'ctx')).rejects.toThrow(EncryptionError);
  });

  it('reports unavailability instead of falling back to plaintext', async () => {
    setKeyStore(null);
    const original = (globalThis as { indexedDB?: unknown }).indexedDB;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    expect(isEncryptionAvailable()).toBe(false);
    await expect(encryptString('x', 'ctx')).rejects.toThrow(EncryptionError);
    if (original) (globalThis as { indexedDB?: unknown }).indexedDB = original;
  });
});
