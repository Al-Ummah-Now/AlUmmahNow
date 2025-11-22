/**
 * TUS Proxy Integration Module
 *
 * This module provides a clean interface for integrating the TUS proxy
 * with the main application router.
 */

export { TusProxy, createTusRouter } from './tusProxy';

/**
 * TUS Proxy Documentation
 *
 * The TUS proxy enables resumable file uploads while keeping Bunny.net
 * credentials and endpoints completely hidden from clients.
 *
 * Client Configuration:
 * ```javascript
 * import * as tus from 'tus-js-client';
 *
 * // First, call the initiate endpoint to create a video record
 * const initResponse = await fetch('/api/videos/upload/initiate', {
 *   method: 'POST',
 *   headers: {
 *     'Authorization': `Bearer ${token}`,
 *     'Content-Type': 'application/json',
 *   },
 *   body: JSON.stringify({
 *     title: 'My Video',
 *     fileSize: file.size,
 *     mimeType: file.type,
 *   }),
 * });
 * const { videoId } = await initResponse.json();
 *
 * // Then use TUS client with the proxy endpoint
 * const upload = new tus.Upload(file, {
 *   endpoint: 'https://api.example.com/api/videos/tus',
 *   headers: {
 *     'Authorization': `Bearer ${token}`,
 *   },
 *   metadata: {
 *     videoId: videoId,
 *     filename: file.name,
 *     filetype: file.type,
 *   },
 *   chunkSize: 5 * 1024 * 1024, // 5MB chunks
 *   retryDelays: [0, 3000, 5000, 10000, 20000],
 *   onError: (error) => {
 *     console.error('Upload failed:', error);
 *   },
 *   onProgress: (bytesUploaded, bytesTotal) => {
 *     const percent = (bytesUploaded / bytesTotal) * 100;
 *     console.log(`Upload progress: ${percent.toFixed(2)}%`);
 *   },
 *   onSuccess: () => {
 *     console.log('Upload complete!');
 *   },
 * });
 *
 * upload.start();
 * ```
 *
 * Server Flow:
 * 1. Client calls `/api/videos/upload/initiate` to create video record
 * 2. Client uploads to `/api/videos/tus` using TUS protocol
 * 3. Proxy forwards all TUS operations to Bunny.net
 * 4. Upload sessions are tracked in KV storage
 * 5. Video status is updated when upload completes
 *
 * Security Features:
 * - JWT authentication required for all operations
 * - Bunny.net credentials never exposed to client
 * - Upload sessions bound to authenticated user
 * - Automatic session expiration (1 hour)
 * - Video ownership verification
 *
 * Protocol Support:
 * - TUS v1.0.0
 * - Extensions: creation, creation-with-upload, termination, concatenation
 * - Max file size: 5GB
 * - Resumable uploads with automatic retry
 */