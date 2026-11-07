/**
 * Story 1.3 AC 1, 5: sensitive values are encrypted at rest with an expiry.
 */
import { installWebCrypto, MemoryKeyStore } from '@/test/webcrypto';
import { setKeyStore } from '@/lib/crypto';
import { EncryptedStorage, ENCRYPTED_KEY_PREFIX } from '../EncryptedStorage';

const DAY = 24 * 60 * 60 * 1000;

describe('EncryptedStorage', () => {
  beforeAll(() => installWebCrypto());

  beforeEach(async () => {
    localStorage.clear();
    setKeyStore(new MemoryKeyStore());
    await EncryptedStorage.clearAll();
    setKeyStore(new MemoryKeyStore());
  });

  it('stores only ciphertext in localStorage', async () => {
    await EncryptedStorage.setItem('watchProgress', { v1: { videoId: 'v1', currentTime: 42 } }, { ttlMs: DAY });
    const raw = localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}watchProgress`)!;
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('v1');
    expect(raw).not.toContain('currentTime');
    expect(JSON.parse(raw)).toEqual({ v: 1, iv: expect.any(String), ct: expect.any(String), exp: expect.any(Number) });
    await expect(EncryptedStorage.getItem('watchProgress')).resolves.toEqual({ v1: { videoId: 'v1', currentTime: 42 } });
  });

  it('expires entries and the sweeper removes them without decrypting', async () => {
    await EncryptedStorage.setItem('a', 1, { ttlMs: DAY });
    await EncryptedStorage.setItem('b', 2, { ttlMs: 10 * DAY });
    expect(EncryptedStorage.purgeExpired(Date.now() + 2 * DAY)).toBe(1);
    expect(localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}a`)).toBeNull();
    expect(localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}b`)).not.toBeNull();
  });

  it('returns null for an expired entry and removes it', async () => {
    await EncryptedStorage.setItem('short', 'x', { ttlMs: 0 });
    await expect(EncryptedStorage.getItem('short')).resolves.toBeNull();
    expect(localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}short`)).toBeNull();
  });

  it('discards tampered or foreign values', async () => {
    await EncryptedStorage.setItem('a', 'secret', { ttlMs: DAY });
    const envelope = JSON.parse(localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}a`)!);
    // Move the ciphertext under another key: AAD binding must reject it.
    localStorage.setItem(`${ENCRYPTED_KEY_PREFIX}b`, JSON.stringify(envelope));
    await expect(EncryptedStorage.getItem('b')).resolves.toBeNull();
    localStorage.setItem(`${ENCRYPTED_KEY_PREFIX}c`, 'not json');
    await expect(EncryptedStorage.getItem('c')).resolves.toBeNull();
  });

  it('clearAll removes every encrypted entry and shreds the key', async () => {
    const store = new MemoryKeyStore();
    setKeyStore(store);
    await EncryptedStorage.setItem('a', 1, { ttlMs: DAY });
    localStorage.setItem('darkmode', 'true');
    await EncryptedStorage.clearAll();
    expect(localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}a`)).toBeNull();
    expect(localStorage.getItem('darkmode')).toBe('true');
    expect(store.keys.size).toBe(0);
  });

  it('keeps values in memory only when encryption is unavailable', async () => {
    setKeyStore(null);
    const original = (globalThis as { indexedDB?: unknown }).indexedDB;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    await EncryptedStorage.setItem('mem', { a: 1 }, { ttlMs: DAY });
    expect(localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}mem`)).toBeNull();
    await expect(EncryptedStorage.getItem('mem')).resolves.toEqual({ a: 1 });
    if (original) (globalThis as { indexedDB?: unknown }).indexedDB = original;
  });
});
