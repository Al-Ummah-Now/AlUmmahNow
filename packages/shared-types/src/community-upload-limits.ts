/**
 * The largest community post upload the API accepts (apps/api-videos community/upload-images.ts and
 * upload-gif.ts) and the composer allows (apps/web community post forms). One source so the browser
 * check and the server check cannot drift apart. Callers take a `CommunityUploadLimits` value, so
 * these defaults can later be replaced by limits read from settings without changing the callers.
 */
export interface CommunityUploadLimits {
  /** Largest still image (JPEG, PNG, WebP, GIF in an image post), in bytes. */
  imageBytes: number;
  /** Largest GIF in a GIF post, in bytes. */
  gifBytes: number;
}

export const COMMUNITY_UPLOAD_LIMITS: Readonly<CommunityUploadLimits> = Object.freeze({
  imageBytes: 5 * 1024 * 1024,
  gifBytes: 10 * 1024 * 1024,
});

export type CommunityUploadKind = 'image' | 'gif';

/** The limit in bytes for one kind of community upload. */
export function communityUploadLimit(kind: CommunityUploadKind, limits: CommunityUploadLimits = COMMUNITY_UPLOAD_LIMITS): number {
  return kind === 'gif' ? limits.gifBytes : limits.imageBytes;
}

/** The `code` of the API's 413 answer for a community upload over the limit. */
export const COMMUNITY_FILE_TOO_LARGE = 'file_too_large' as const;

/** The API's 413 body for a community upload over the limit. */
export interface CommunityFileTooLargeBody {
  error: string;
  code: typeof COMMUNITY_FILE_TOO_LARGE;
  fileName: string;
  size: number;
  maxBytes: number;
}

/** The API's 413 body when a file is over its kind's limit, or null when it fits. */
export function communityFileTooLarge(
  kind: CommunityUploadKind,
  fileName: string,
  size: number,
  limits: CommunityUploadLimits = COMMUNITY_UPLOAD_LIMITS,
): CommunityFileTooLargeBody | null {
  const maxBytes = communityUploadLimit(kind, limits);
  if (size <= maxBytes) return null;
  const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return {
    error: `${fileName} is larger than the ${mb} MB limit for ${kind === 'gif' ? 'GIFs' : 'images'}`,
    code: COMMUNITY_FILE_TOO_LARGE,
    fileName,
    size,
    maxBytes,
  };
}
