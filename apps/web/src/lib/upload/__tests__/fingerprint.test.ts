/**
 * Upload fingerprint: the same file gives the same fingerprint (so a retry
 * reuses its video on the server); a different file gives another one.
 */
import { webcrypto } from 'crypto';
import { Blob as NodeBlob } from 'buffer';
import { computeFileFingerprint, fingerprintBytes, FINGERPRINT_EDGE_BYTES, tryFileFingerprint } from '../fingerprint';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

function fakeFile(bytes: Uint8Array, name = 'lecture.mp4', lastModified = 1762700000000) {
  const blob = new NodeBlob([bytes]);
  return {
    name,
    size: bytes.length,
    lastModified,
    slice: (start?: number, end?: number) => blob.slice(start, end) as unknown as Blob,
  };
}

function pattern(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

describe('computeFileFingerprint', () => {
  it('is stable for the same file and carries name, size and lastModified', async () => {
    const bytes = pattern(3000);
    const a = await computeFileFingerprint(fakeFile(bytes), subtle);
    const b = await computeFileFingerprint(fakeFile(bytes.slice()), subtle);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ name: 'lecture.mp4', size: 3000, lastModified: 1762700000000 });
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs when the content differs', async () => {
    const a = await computeFileFingerprint(fakeFile(pattern(3000, 1)), subtle);
    const b = await computeFileFingerprint(fakeFile(pattern(3000, 2)), subtle);
    expect(a.hash).not.toBe(b.hash);
  });

  it('hashes only the first and last MiB of a large file', async () => {
    const size = 3 * FINGERPRINT_EDGE_BYTES;
    const bytes = pattern(size);
    const read = await fingerprintBytes(fakeFile(bytes));
    expect(read.length).toBe(2 * FINGERPRINT_EDGE_BYTES);
    expect(read[0]).toBe(bytes[0]);
    expect(read[read.length - 1]).toBe(bytes[size - 1]);
    // A change in the middle does not change the fingerprint (cheap on multi-GB files)
    const middle = bytes.slice();
    middle[Math.floor(size / 2)] ^= 0xff;
    const a = await computeFileFingerprint(fakeFile(bytes), subtle);
    const b = await computeFileFingerprint(fakeFile(middle), subtle);
    expect(a.hash).toBe(b.hash);
  });

  it('tryFileFingerprint never throws (an upload without one still works)', async () => {
    const broken = { name: 'x.mp4', size: 10, lastModified: 0, slice: () => { throw new Error('unreadable'); } };
    await expect(tryFileFingerprint(broken as never)).resolves.toBeUndefined();
  });
});
