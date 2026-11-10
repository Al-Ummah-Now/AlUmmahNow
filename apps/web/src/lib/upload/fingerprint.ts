/**
 * File fingerprint sent with upload initiate. The server keys an unfinished
 * upload on channel + uploader + fingerprint, so picking the same file again
 * (another tab, another browser, after clearing storage) reuses its video and
 * resumes its upload instead of creating a new Bunny video per attempt
 * (api-videos lib/uploads/initiateOnce.ts).
 *
 * name, size and lastModified, plus a SHA-256 of the first and last MiB: cheap
 * on a multi-GB file, and two different recordings with the same name and
 * size do not collide.
 */

import { logger } from '@/lib/logger-client';

export interface UploadFingerprint {
  name: string;
  size: number;
  lastModified: number;
  /** SHA-256 (hex) of the first and last MiB */
  hash: string;
}

export const FINGERPRINT_EDGE_BYTES = 1024 * 1024;

type FileLike = Pick<File, 'name' | 'size' | 'lastModified' | 'slice'>;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  // Older engines (and jsdom): FileReader
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Bytes hashed: the first MiB, then the last MiB (the whole file when it is smaller than 2 MiB). */
export async function fingerprintBytes(file: FileLike): Promise<Uint8Array> {
  const edge = FINGERPRINT_EDGE_BYTES;
  if (file.size <= 2 * edge) return readBytes(file.slice(0, file.size));
  const [head, tail] = await Promise.all([readBytes(file.slice(0, edge)), readBytes(file.slice(file.size - edge, file.size))]);
  const joined = new Uint8Array(head.length + tail.length);
  joined.set(head, 0);
  joined.set(tail, head.length);
  return joined;
}

export async function computeFileFingerprint(file: FileLike, subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle): Promise<UploadFingerprint> {
  if (!subtle) throw new Error('Web Crypto is unavailable');
  const bytes = await fingerprintBytes(file);
  const digest = await subtle.digest('SHA-256', bytes as BufferSource);
  return { name: file.name, size: file.size, lastModified: file.lastModified, hash: toHex(digest) };
}

/**
 * The fingerprint, or undefined when it cannot be computed (no Web Crypto on
 * an insecure origin, an unreadable file): the upload still works, it only
 * loses the reuse across attempts.
 */
export async function tryFileFingerprint(file: FileLike): Promise<UploadFingerprint | undefined> {
  try {
    return await computeFileFingerprint(file);
  } catch (error) {
    logger.warn('[upload] File fingerprint unavailable; a retry of this file creates a new video', { name: file.name, error });
    return undefined;
  }
}
