/**
 * Build per-file TUS upload entries for a batch upload.
 *
 * The API returns one TUS proxy session per requested video, in request order.
 * Each file is uploaded to the API's TUS proxy (/api/videos/tus) with the
 * session ID in the upload metadata - the same flow as the single upload.
 */

import type { BatchUploadInitiateResponse, TusConfig } from '@al-ummah/shared-types';

export type BatchSession = NonNullable<BatchUploadInitiateResponse['result']>[number];

export interface BatchUploadEntryInput {
  files: File[];
  sessions: BatchSession[];
  apiUrl: string;
  /** Full Authorization header value, e.g. "Bearer <token>" */
  authorization: string;
  /** Optional override for chunk size (falls back to the session's recommendation) */
  chunkSize?: number;
}

export interface BuiltBatchUploadEntry {
  file: File;
  videoId: string;
  tusConfig: TusConfig;
}

export function getTusProxyEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/api/videos/tus`;
}

export function buildBatchUploadEntries({
  files,
  sessions,
  apiUrl,
  authorization,
  chunkSize,
}: BatchUploadEntryInput): BuiltBatchUploadEntry[] {
  if (sessions.length !== files.length) {
    throw new Error(`Batch session count (${sessions.length}) does not match file count (${files.length})`);
  }

  const endpoint = getTusProxyEndpoint(apiUrl);

  return files.map((file, index) => {
    const session = sessions[index];
    if (!session?.tusSessionId || !session.videoId) {
      throw new Error(`Missing TUS session for file ${file.name}`);
    }

    return {
      file,
      videoId: session.videoId,
      tusConfig: {
        tusEndpoint: endpoint,
        tusHeaders: { Authorization: authorization },
        metadata: {
          tusSessionId: session.tusSessionId,
          videoId: session.videoId,
        },
        chunkSize: chunkSize || session.chunkSize,
        expiresAt: session.expiresAt,
      },
    };
  });
}
