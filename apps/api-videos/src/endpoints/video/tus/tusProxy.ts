/**
 * TUS Protocol Proxy for Bunny.net
 *
 * This module implements a secure proxy for the TUS (Tus Resumable Upload) protocol
 * that forwards requests to Bunny.net while hiding the actual endpoint from clients.
 *
 * Architecture:
 * Client (tus-js-client) → API Proxy (this) → Bunny.net TUS Server
 *
 * Security Benefits:
 * - Bunny.net credentials never exposed to client
 * - Complete control over authentication and authorization
 * - Ability to add custom rate limiting and monitoring
 * - Can inject metadata and modify requests as needed
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthContext } from '../../../middleware/auth';
import { requireSecret } from '../../../lib/env-helpers';
import { generateTUSSignature } from '../../../lib/bunny/tus';
import R2Repository from '../../../lib/r2Repo';
import { Video as BusinessVideo } from '../../../lib/types';
import Queue, { MessageType } from '../../../lib/queue';
import { logger } from '../../../lib/logger';

// TUS Protocol Constants
const TUS_VERSION = '1.0.0';
const TUS_EXTENSIONS = ['creation', 'creation-with-upload', 'termination', 'concatenation'];
const BUNNY_TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload';

// Upload metadata stored in KV for session management
interface TusUploadSession {
  videoId: string;
  userId: string;
  bunnyUploadUrl?: string;
  fileSize: number;
  uploadOffset: number;
  createdAt: string;
  expiresAt: string;
  metadata?: Record<string, string>;
}

/**
 * TUS Proxy Router
 * Handles all TUS protocol operations as a proxy to Bunny.net
 */
export class TusProxy {
  private env: any;
  private authContext: any;

  constructor(env: any, authContext: any) {
    this.env = env;
    this.authContext = authContext;
  }

  /**
   * Get KV namespace for TUS sessions
   */
  private getSessionStore() {
    return this.env.TUS_SESSIONS;
  }

  /**
   * Generate session key for KV storage
   */
  private getSessionKey(uploadId: string): string {
    return `tus:upload:${uploadId}`;
  }

  /**
   * Create Bunny.net authorization headers
   */
  private async createBunnyHeaders(videoId: string): Promise<Record<string, string>> {
    const bunnyKey = await requireSecret(this.env["bunny-stream-key"], 'bunny-stream-key');
    const libraryIdRaw = await requireSecret(this.env.bunny_stream_library_id, 'bunny_stream_library_id');
    const libraryId = parseInt(libraryIdRaw, 10);

    // Generate signature with 1 hour expiration
    const expirationTime = Math.floor(Date.now() / 1000) + 3600;
    const signature = await generateTUSSignature(
      libraryId,
      bunnyKey,
      expirationTime,
      videoId
    );

    return {
      'AuthorizationSignature': signature,
      'AuthorizationExpire': expirationTime.toString(),
      'LibraryId': libraryId.toString(),
      'VideoId': videoId,
    };
  }

  /**
   * OPTIONS - Handle CORS preflight and TUS capabilities
   */
  async handleOptions(c: any): Promise<Response> {
    logger.info('[TUS Proxy] OPTIONS request');

    return new Response(null, {
      status: 204,
      headers: {
        'Tus-Resumable': TUS_VERSION,
        'Tus-Version': TUS_VERSION,
        'Tus-Max-Size': '5368709120', // 5GB max
        'Tus-Extension': TUS_EXTENSIONS.join(','),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, HEAD, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Upload-Length, Upload-Offset, Tus-Resumable, Upload-Metadata, Upload-Defer-Length, Upload-Concat',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Expose-Headers': 'Upload-Offset, Location, Tus-Resumable, Tus-Version, Tus-Max-Size, Tus-Extension, Upload-Length, Upload-Metadata',
      },
    });
  }

  /**
   * POST - Create new upload
   */
  async handlePost(c: any): Promise<Response> {
    const userId = this.authContext?.userId;
    if (!userId) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    try {
      // Parse TUS headers
      const uploadLength = c.req.header('Upload-Length');
      const uploadMetadata = c.req.header('Upload-Metadata');
      const uploadDeferLength = c.req.header('Upload-Defer-Length');

      logger.info('[TUS Proxy] POST - Create upload', {
        userId,
        uploadLength,
        uploadMetadata,
        uploadDeferLength,
      });

      // Parse metadata (base64 encoded key-value pairs)
      const metadata = this.parseUploadMetadata(uploadMetadata || '');
      const tusSessionId = metadata.tusSessionId;

      if (!tusSessionId) {
        return c.json({ error: 'tusSessionId required in metadata' }, 400);
      }

      // Retrieve TUS session from KV (created during initiate)
      const kv = this.getSessionStore();
      const sessionKey = `tus:session:${tusSessionId}`;
      const sessionData = await kv.get(sessionKey);

      if (!sessionData) {
        return c.json({ error: 'TUS session not found or expired' }, 404);
      }

      const storedSession = JSON.parse(sessionData);
      const videoId = storedSession.videoId;

      // Verify ownership
      if (storedSession.userId !== userId) {
        return c.json({ error: 'Unauthorized' }, 403);
      }

      // The quota was reserved for the declared size, so the upload cannot be larger
      const quotaVideo = this.env.videos ? await new R2Repository<z.infer<typeof BusinessVideo>>(this.env.videos).getObject(videoId) : null;
      if (quotaVideo?.entitlementChecked && quotaVideo.usageBytes) {
        const declared = parseInt(uploadLength || '', 10);
        if (!Number.isFinite(declared) || declared > quotaVideo.usageBytes) {
          logger.warn('[TUS Proxy] Upload-Length does not match the declared size', { videoId, uploadLength, declared: quotaVideo.usageBytes });
          return c.json({ error: 'Upload-Length exceeds the declared file size' }, 400);
        }
      }

      logger.info('[TUS Proxy] Retrieved TUS session', {
        tusSessionId,
        videoId,
        userId,
      });

      // Build headers for Bunny.net request
      // IMPORTANT: Upload-Length and Upload-Defer-Length are mutually exclusive
      const requestHeaders: Record<string, string> = {
        ...storedSession.tusHeaders,
        'Tus-Resumable': TUS_VERSION,
        'Upload-Metadata': uploadMetadata || '',
      };

      // Only include Upload-Length OR Upload-Defer-Length, never both
      if (uploadLength) {
        requestHeaders['Upload-Length'] = uploadLength;
      } else if (uploadDeferLength) {
        requestHeaders['Upload-Defer-Length'] = uploadDeferLength;
      }

      logger.info('[TUS Proxy] Forwarding POST to Bunny.net', {
        endpoint: storedSession.tusEndpoint,
        headers: requestHeaders,
        storedHeaders: storedSession.tusHeaders,
      });

      // Forward POST to Bunny.net using stored TUS headers
      const bunnyResponse = await fetch(storedSession.tusEndpoint, {
        method: 'POST',
        headers: requestHeaders,
      });

      if (!bunnyResponse.ok) {
        // Try to get error details from response body
        let errorBody = null;
        try {
          errorBody = await bunnyResponse.text();
        } catch (e) {
          // Ignore if can't read body
        }

        logger.error('[TUS Proxy] Bunny.net POST failed', {
          status: bunnyResponse.status,
          statusText: bunnyResponse.statusText,
          responseBody: errorBody,
          requestEndpoint: storedSession.tusEndpoint,
          requestHeaders: requestHeaders,
        });
        return c.json({ error: 'Upload creation failed', details: errorBody }, bunnyResponse.status);
      }

      // Get the Location header from Bunny's response
      const bunnyLocation = bunnyResponse.headers.get('Location');
      if (!bunnyLocation) {
        throw new Error('No Location header in Bunny response');
      }

      // Convert relative URL to absolute URL if needed
      let bunnyUploadUrl = bunnyLocation;
      if (bunnyLocation.startsWith('/')) {
        // Relative URL - prepend Bunny.net base URL
        bunnyUploadUrl = `https://video.bunnycdn.com${bunnyLocation}`;
        logger.info('[TUS Proxy] Converted relative Location to absolute', {
          relative: bunnyLocation,
          absolute: bunnyUploadUrl,
        });
      }

      // Store session in KV for subsequent PATCH requests
      const session: TusUploadSession = {
        videoId,
        userId,
        bunnyUploadUrl,
        fileSize: parseInt(uploadLength || '0', 10),
        uploadOffset: 0,
        createdAt: new Date().toISOString(),
        expiresAt: storedSession.expiresAt,
        metadata,
      };

      await kv.put(this.getSessionKey(tusSessionId), JSON.stringify(session), {
        expirationTtl: 3600, // 1 hour TTL
      });

      // Return proxy location using tusSessionId
      const proxyLocation = `${c.req.url}/${tusSessionId}`;

      return new Response(null, {
        status: 201,
        headers: {
          'Location': proxyLocation,
          'Tus-Resumable': TUS_VERSION,
          'Access-Control-Expose-Headers': 'Location, Tus-Resumable',
        },
      });

    } catch (error) {
      logger.error('[TUS Proxy] POST error', error);
      return c.json({ error: 'Failed to create upload' }, 500);
    }
  }

  /**
   * HEAD - Get upload offset
   */
  async handleHead(c: any, uploadId: string): Promise<Response> {
    try {
      logger.info('[TUS Proxy] HEAD - Get offset', { uploadId });

      // Get session from KV
      const kv = this.getSessionStore();
      const sessionData = await kv.get(this.getSessionKey(uploadId));

      if (!sessionData) {
        return new Response(null, { status: 404 });
      }

      const session: TusUploadSession = JSON.parse(sessionData);

      // Verify ownership
      if (session.userId !== this.authContext?.userId) {
        return new Response(null, { status: 403 });
      }

      // Forward HEAD to Bunny.net
      const bunnyHeaders = await this.createBunnyHeaders(session.videoId);
      const bunnyResponse = await fetch(session.bunnyUploadUrl!, {
        method: 'HEAD',
        headers: {
          ...bunnyHeaders,
          'Tus-Resumable': TUS_VERSION,
        },
      });

      if (!bunnyResponse.ok) {
        return new Response(null, { status: bunnyResponse.status });
      }

      // Get current offset from Bunny
      const uploadOffset = bunnyResponse.headers.get('Upload-Offset') || '0';
      const uploadLength = bunnyResponse.headers.get('Upload-Length') || session.fileSize.toString();

      // Update session with current offset
      session.uploadOffset = parseInt(uploadOffset, 10);
      await kv.put(this.getSessionKey(uploadId), JSON.stringify(session), {
        expirationTtl: 3600,
      });

      return new Response(null, {
        status: 200,
        headers: {
          'Upload-Offset': uploadOffset,
          'Upload-Length': uploadLength,
          'Tus-Resumable': TUS_VERSION,
          'Cache-Control': 'no-store',
          'Access-Control-Expose-Headers': 'Upload-Offset, Upload-Length, Tus-Resumable',
        },
      });

    } catch (error) {
      logger.error('[TUS Proxy] HEAD error', { uploadId, error });
      return new Response(null, { status: 500 });
    }
  }

  /**
   * PATCH - Upload chunk
   * This is the most critical method - must stream data efficiently
   */
  async handlePatch(c: any, uploadId: string): Promise<Response> {
    try {
      // Parse headers
      const uploadOffset = c.req.header('Upload-Offset');
      const contentType = c.req.header('Content-Type');

      logger.info('[TUS Proxy] PATCH - Upload chunk', {
        uploadId,
        uploadOffset,
        contentType,
      });

      // Validate content type
      if (contentType !== 'application/offset+octet-stream') {
        return c.json({ error: 'Invalid Content-Type' }, 415);
      }

      // Get session from KV
      const kv = this.getSessionStore();
      const sessionData = await kv.get(this.getSessionKey(uploadId));

      if (!sessionData) {
        return c.json({ error: 'Upload not found' }, 404);
      }

      const session: TusUploadSession = JSON.parse(sessionData);

      // Verify ownership
      if (session.userId !== this.authContext?.userId) {
        return c.json({ error: 'Unauthorized' }, 403);
      }

      // Check if bunnyUploadUrl exists
      if (!session.bunnyUploadUrl) {
        logger.error('[TUS Proxy] No bunnyUploadUrl in session', {
          uploadId,
          sessionKeys: Object.keys(session),
          session: JSON.stringify(session),
        });
        return c.json({ error: 'Upload session incomplete - bunnyUploadUrl missing' }, 500);
      }

      // Create Bunny.net headers
      const bunnyHeaders = await this.createBunnyHeaders(session.videoId);

      // IMPORTANT: Stream the request body directly to Bunny.net
      // Don't buffer the entire file in memory!
      const requestBody = c.req.raw.body;

      if (!requestBody) {
        return c.json({ error: 'No request body' }, 400);
      }

      // Forward PATCH to Bunny.net with streaming
      const bunnyResponse = await fetch(session.bunnyUploadUrl!, {
        method: 'PATCH',
        headers: {
          ...bunnyHeaders,
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': uploadOffset || '0',
          'Tus-Resumable': TUS_VERSION,
        },
        body: requestBody, // Stream directly
        // @ts-ignore - Cloudflare Workers specific
        duplex: 'half', // Required for streaming in Workers
      });

      if (!bunnyResponse.ok) {
        logger.error('[TUS Proxy] Bunny.net PATCH failed', {
          status: bunnyResponse.status,
          statusText: bunnyResponse.statusText,
        });
        return c.json({ error: 'Upload failed' }, bunnyResponse.status);
      }

      // Get updated offset from Bunny
      const newOffset = bunnyResponse.headers.get('Upload-Offset') || uploadOffset;

      // Update session
      session.uploadOffset = parseInt(newOffset || '0', 10);
      await kv.put(this.getSessionKey(uploadId), JSON.stringify(session), {
        expirationTtl: 3600,
      });

      // Check if upload is complete
      if (session.uploadOffset >= session.fileSize) {
        // Update video status in R2
        const bucket = this.env.videos;
        const repository = new R2Repository<z.infer<typeof BusinessVideo>>(bucket);
        const video = await repository.getObject(session.videoId);

        if (video) {
          video.uploadStatus = 'processing';
          await repository.putObject(session.videoId, video);
        }

        // Track upload completion
        const queue = new Queue(this.env.queue);
        await queue.send(MessageType.VideoUploadCompleted, {
          videoId: session.videoId,
          userId: session.userId,
          uploadId,
          fileSize: session.fileSize,
          timestamp: new Date().toISOString(),
        });

        logger.info('[TUS Proxy] Upload completed', {
          uploadId,
          videoId: session.videoId,
          fileSize: session.fileSize,
        });
      }

      return new Response(null, {
        status: 204,
        headers: {
          'Upload-Offset': newOffset || uploadOffset || '0',
          'Tus-Resumable': TUS_VERSION,
          'Access-Control-Expose-Headers': 'Upload-Offset, Tus-Resumable',
        },
      });

    } catch (error) {
      logger.error('[TUS Proxy] PATCH error', {
        uploadId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      });
      return c.json({
        error: 'Upload failed',
        details: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  }

  /**
   * DELETE - Terminate upload
   */
  async handleDelete(c: any, uploadId: string): Promise<Response> {
    try {
      logger.info('[TUS Proxy] DELETE - Terminate upload', { uploadId });

      // Get session from KV
      const kv = this.getSessionStore();
      const sessionData = await kv.get(this.getSessionKey(uploadId));

      if (!sessionData) {
        return new Response(null, { status: 404 });
      }

      const session: TusUploadSession = JSON.parse(sessionData);

      // Verify ownership
      if (session.userId !== this.authContext?.userId) {
        return new Response(null, { status: 403 });
      }

      // Forward DELETE to Bunny.net
      const bunnyHeaders = await this.createBunnyHeaders(session.videoId);
      await fetch(session.bunnyUploadUrl!, {
        method: 'DELETE',
        headers: {
          ...bunnyHeaders,
          'Tus-Resumable': TUS_VERSION,
        },
      });

      // Delete session from KV
      await kv.delete(this.getSessionKey(uploadId));

      // Track upload cancellation
      const queue = new Queue(this.env.queue);
      await queue.send(MessageType.VideoUploadCancelled, {
        videoId: session.videoId,
        userId: session.userId,
        uploadId,
        timestamp: new Date().toISOString(),
      });

      return new Response(null, {
        status: 204,
        headers: {
          'Tus-Resumable': TUS_VERSION,
        },
      });

    } catch (error) {
      logger.error('[TUS Proxy] DELETE error', { uploadId, error });
      return new Response(null, { status: 500 });
    }
  }

  /**
   * Parse TUS Upload-Metadata header
   * Format: key1 base64value1,key2 base64value2
   */
  private parseUploadMetadata(metadataHeader: string): Record<string, string> {
    const metadata: Record<string, string> = {};

    if (!metadataHeader) return metadata;

    const pairs = metadataHeader.split(',');
    for (const pair of pairs) {
      const [key, base64Value] = pair.trim().split(' ');
      if (key && base64Value) {
        try {
          // Decode base64 value
          const value = atob(base64Value);
          metadata[key] = value;
        } catch (e) {
          logger.warn('[TUS Proxy] Failed to decode metadata', { key, base64Value });
        }
      }
    }

    return metadata;
  }
}

/**
 * Create Hono router for TUS endpoints
 */
export function createTusRouter(): Hono {
  const router = new Hono();

  // OPTIONS - Handle preflight and capabilities
  router.options('/', async (c) => {
    const authContext = getAuthContext(c);
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handleOptions(c);
  });

  router.options('/:uploadId', async (c) => {
    const authContext = getAuthContext(c);
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handleOptions(c);
  });

  // POST - Create upload
  router.post('/', async (c) => {
    const authContext = getAuthContext(c);
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handlePost(c);
  });

  // HEAD - Get upload offset.
  // Hono dispatches HEAD requests to GET routes (and drops the body), so a
  // route registered with router.on('HEAD') is never matched; without this
  // every resume check returned 404 and tus restarted uploads from byte 0.
  router.get('/:uploadId', async (c) => {
    if (c.req.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'POST, HEAD, PATCH, DELETE, OPTIONS' } });
    }
    const authContext = getAuthContext(c);
    const uploadId = c.req.param('uploadId');
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handleHead(c, uploadId);
  });

  // PATCH - Upload chunk
  router.patch('/:uploadId', async (c) => {
    const authContext = getAuthContext(c);
    const uploadId = c.req.param('uploadId');
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handlePatch(c, uploadId);
  });

  // DELETE - Terminate upload
  router.delete('/:uploadId', async (c) => {
    const authContext = getAuthContext(c);
    const uploadId = c.req.param('uploadId');
    const proxy = new TusProxy(c.env, authContext);
    return proxy.handleDelete(c, uploadId);
  });

  return router;
}