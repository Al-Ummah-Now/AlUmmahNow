/**
 * Bunny.net TUS (Tus Resumable Upload Protocol) Integration
 *
 * This module provides utilities for integrating with Bunny.net's native TUS support
 * for resumable video uploads. TUS allows large files to be uploaded in chunks with
 * automatic resume capabilities if the upload is interrupted.
 *
 * @see https://docs.bunny.net/reference/tus-resumable-uploads
 * @see https://tus.io/protocols/resumable-upload.html
 */

import { logger } from '../logger';
import { requireSecret } from '../env-helpers';

/**
 * Generate a TUS authorization signature for Bunny.net video uploads
 *
 * The signature is calculated using SHA-256 hashing with the following formula:
 * sha256(library_id + api_key + expiration_time + video_id)
 *
 * @param libraryId - The Bunny.net Stream library ID
 * @param apiKey - The Bunny.net Stream API key (should be kept secret)
 * @param expirationTime - Unix timestamp when the signature expires
 * @param videoId - The GUID of the video being uploaded
 * @returns Hex-encoded SHA-256 signature
 *
 * @example
 * ```typescript
 * const signature = await generateTUSSignature(
 *   12345,                        // Library ID
 *   'your-api-key',               // API Key (secret)
 *   Math.floor(Date.now() / 1000) + 3600,  // Expires in 1 hour
 *   'abc123-def456-789'           // Video GUID
 * );
 * // Returns: "a1b2c3d4e5f6..."
 * ```
 */
export async function generateTUSSignature(
  libraryId: number,
  apiKey: string,
  expirationTime: number,
  videoId: string
): Promise<string> {
  // Validate inputs
  if (!libraryId || libraryId <= 0) {
    throw new Error('Invalid library ID: must be a positive number');
  }
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('Invalid API key: must be a non-empty string');
  }
  if (!expirationTime || expirationTime <= 0) {
    throw new Error('Invalid expiration time: must be a positive Unix timestamp');
  }
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('Invalid video ID: must be a non-empty string');
  }

  // Ensure expiration is in the future (with 5 second tolerance for clock skew)
  const now = Math.floor(Date.now() / 1000);
  if (expirationTime <= now - 5) {
    throw new Error('Expiration time must be in the future');
  }

  // Build the signature string according to Bunny.net's formula
  const signatureString = `${libraryId}${apiKey}${expirationTime}${videoId}`;

  // Use Web Crypto API for SHA-256 hashing (Cloudflare Workers compatible)
  const encoder = new TextEncoder();
  const data = encoder.encode(signatureString);

  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert buffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');

    return hashHex;
  } catch (error) {
    logger.error('Failed to generate TUS signature:', error);
    throw new Error('Failed to generate TUS signature');
  }
}

/**
 * TUS configuration for client-side upload
 */
export interface TUSUploadConfig {
  /**
   * The TUS endpoint URL for Bunny.net
   */
  tusEndpoint: string;

  /**
   * Headers required for TUS upload authentication
   */
  tusHeaders: {
    /**
     * The authorization signature
     */
    AuthorizationSignature: string;

    /**
     * Unix timestamp when the signature expires
     */
    AuthorizationExpire: string;

    /**
     * The Bunny.net Stream library ID
     */
    LibraryId: string;

    /**
     * The video GUID
     */
    VideoId: string;
  };

  /**
   * ISO 8601 datetime when the upload authorization expires
   */
  expiresAt: string;

  /**
   * Recommended chunk size in bytes (5MB default)
   */
  chunkSize: number;

  /**
   * Whether the upload supports resuming
   */
  resumable: boolean;
}

/**
 * Generate a complete TUS upload configuration for client-side use
 *
 * @param libraryId - The Bunny.net Stream library ID
 * @param apiKey - The Bunny.net Stream API key (secret)
 * @param videoId - The GUID of the video being uploaded
 * @param expirationHours - How many hours until the signature expires (default: 1)
 * @returns Complete TUS configuration object for client
 *
 * @example
 * ```typescript
 * const config = await generateTUSConfig(
 *   12345,
 *   'your-api-key',
 *   'abc123-def456-789',
 *   2  // Expires in 2 hours
 * );
 * // Use config with tus-js-client or similar library
 * ```
 */
export async function generateTUSConfig(
  libraryId: number,
  apiKey: string,
  videoId: string,
  expirationHours: number = 1
): Promise<TUSUploadConfig> {
  // Calculate expiration time
  const now = Math.floor(Date.now() / 1000);
  const expirationTime = now + (expirationHours * 3600);

  // Generate the signature
  const signature = await generateTUSSignature(
    libraryId,
    apiKey,
    expirationTime,
    videoId
  );

  // Create ISO datetime for expiration
  const expiresAt = new Date(expirationTime * 1000).toISOString();

  return {
    tusEndpoint: 'https://video.bunnycdn.com/tusupload',
    tusHeaders: {
      AuthorizationSignature: signature,
      AuthorizationExpire: expirationTime.toString(),
      LibraryId: libraryId.toString(),
      VideoId: videoId,
    },
    expiresAt,
    chunkSize: 5 * 1024 * 1024, // 5MB recommended chunk size
    resumable: true,
  };
}

/**
 * Validate if a TUS upload configuration is still valid
 *
 * @param config - The TUS configuration to validate
 * @returns true if the configuration is still valid, false otherwise
 */
export function isTUSConfigValid(config: TUSUploadConfig): boolean {
  if (!config || !config.expiresAt) {
    return false;
  }

  const expirationTime = new Date(config.expiresAt).getTime();
  const now = Date.now();

  // Check if expired (with 30 second buffer for clock skew)
  return expirationTime > now + 30000;
}

/**
 * TUS proxy session stored in KV.
 *
 * The client never receives Bunny.net credentials; it only gets the opaque
 * session ID and sends it as `tusSessionId` upload metadata to the TUS proxy
 * (/api/videos/tus), which resolves the session and forwards to Bunny.net.
 */
export interface TusProxySession {
  videoId: string;
  userId: string;
  channelId: string;
  tusEndpoint: string;
  tusHeaders: TUSUploadConfig['tusHeaders'];
  expiresAt: string;
  createdAt: string;
}

/** KV key the TUS proxy uses to resolve a session ID. */
export function getTusSessionKey(tusSessionId: string): string {
  return `tus:session:${tusSessionId}`;
}

/**
 * How long an initiate/resume session stays usable. Written once, read once
 * (by the proxy's POST), so a long life is free. One hour lost the sessions of
 * files queued behind others in a bulk batch before they ever started. The
 * Bunny signature stored with it is not used by the proxy (it signs each
 * request itself), so it may expire long before the session does.
 */
export const TUS_PROXY_SESSION_TTL_SECONDS = 7 * 24 * 3600;

/**
 * Persist a TUS proxy session and return its ID.
 * Shared by single and batch upload initiation and by upload resume, so all
 * use the same proxy flow.
 */
export async function createTusProxySession(
  kv: KVNamespace,
  params: { videoId: string; userId: string; channelId: string; tusConfig: TUSUploadConfig },
  ttlSeconds: number = TUS_PROXY_SESSION_TTL_SECONDS
): Promise<string> {
  const tusSessionId = crypto.randomUUID();
  const session: TusProxySession = {
    videoId: params.videoId,
    userId: params.userId,
    channelId: params.channelId,
    tusEndpoint: params.tusConfig.tusEndpoint,
    tusHeaders: params.tusConfig.tusHeaders,
    expiresAt: params.tusConfig.expiresAt,
    createdAt: new Date().toISOString(),
  };

  await kv.put(getTusSessionKey(tusSessionId), JSON.stringify(session), {
    expirationTtl: ttlSeconds,
  });

  logger.debug('[TUS] Proxy session created', {
    tusSessionId,
    videoId: params.videoId,
    userId: params.userId,
  });

  return tusSessionId;
}
interface SecretLike { text?(): Promise<string>; get?(): Promise<string> }

/**
 * Headers for a server-side request to a Bunny TUS upload URL (HEAD, PATCH,
 * POST, DELETE): a fresh 1-hour signature each time, so nothing signed
 * earlier can expire under a long upload.
 */
export async function bunnyTusRequestHeaders(
  env: { 'bunny-stream-key': SecretLike | string; bunny_stream_library_id: SecretLike | string },
  videoId: string,
): Promise<Record<string, string>> {
  const bunnyKey = await requireSecret(env['bunny-stream-key'] as never, 'bunny-stream-key');
  const libraryId = parseInt(await requireSecret(env.bunny_stream_library_id as never, 'bunny_stream_library_id'), 10);
  const expirationTime = Math.floor(Date.now() / 1000) + 3600;
  const signature = await generateTUSSignature(libraryId, bunnyKey, expirationTime, videoId);
  return {
    AuthorizationSignature: signature,
    AuthorizationExpire: expirationTime.toString(),
    LibraryId: libraryId.toString(),
    VideoId: videoId,
  };
}
