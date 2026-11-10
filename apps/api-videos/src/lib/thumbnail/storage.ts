/**
 * Thumbnail storage abstraction
 * Handles storing thumbnails in R2 or Bunny.net Storage
 */

import BunnyStorageClient from '../bunny/storage';
import { THUMBNAIL_SIZES, sizeQuery, thumbnailSizeUrls } from './processor';

export interface ThumbnailStorageResult {
  url: string;
  cdnUrl: string;
  thumbnailSizes: Record<string, string>;
}

export class ThumbnailStorage {
  /**
   * Store thumbnail in R2
   * Stores the original image and generates CDN URLs with Image Optimizer parameters
   */
  async storeInR2(
    videoId: string,
    imageBuffer: ArrayBuffer,
    mimeType: string,
    bucket: R2Bucket,
    cdnBaseUrl: string
  ): Promise<ThumbnailStorageResult> {
    const key = `thumbnails/${videoId}/original.jpg`;

    // Store in R2
    await bucket.put(key, imageBuffer, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000', // 1 year
      },
      customMetadata: {
        videoId,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Generate CDN URL
    const baseUrl = `${cdnBaseUrl}/${key}`;

    // Size variants by width only: the image keeps its own aspect ratio
    const thumbnailSizes = thumbnailSizeUrls(baseUrl);

    return {
      url: baseUrl,
      cdnUrl: thumbnailSizes.hd,
      thumbnailSizes,
    };
  }

  /**
   * Store thumbnail in Bunny.net Storage
   * Uses Bunny.net's native storage with Image Optimizer
   */
  async storeInBunny(
    videoId: string,
    imageBuffer: ArrayBuffer,
    storageZone: string,
    storageKey: string,
    cdnBaseUrl: string
  ): Promise<ThumbnailStorageResult> {
    const client = new BunnyStorageClient(storageZone, storageKey);
    const path = `thumbnails/${videoId}/custom.jpg`;

    // Convert ArrayBuffer to ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(imageBuffer));
        controller.close();
      }
    });

    // Upload to Bunny.net Storage
    await client.putFile(path, stream);

    // Generate CDN URL
    const baseUrl = `${cdnBaseUrl}/${path}`;

    // Size variants by width only: the image keeps its own aspect ratio
    const thumbnailSizes = thumbnailSizeUrls(baseUrl);

    return {
      url: baseUrl,
      cdnUrl: thumbnailSizes.hd,
      thumbnailSizes,
    };
  }

  /**
   * Delete thumbnail from R2
   */
  async deleteFromR2(videoId: string, bucket: R2Bucket): Promise<void> {
    const key = `thumbnails/${videoId}/original.jpg`;
    await bucket.delete(key);
  }

  /**
   * Delete thumbnail from Bunny.net Storage
   */
  async deleteFromBunny(
    videoId: string,
    storageZone: string,
    storageKey: string
  ): Promise<void> {
    const client = new BunnyStorageClient(storageZone, storageKey);
    const path = `thumbnails/${videoId}/custom.jpg`;
    await client.deleteFile(path);
  }

  /**
   * Get thumbnail URL from R2
   */
  getR2Url(videoId: string, cdnBaseUrl: string, size: 'hd' | 'sd' | 'mobile' | 'thumb' = 'hd'): string {
    const key = `thumbnails/${videoId}/original.jpg`;
    const baseUrl = `${cdnBaseUrl}/${key}`;

    const spec = THUMBNAIL_SIZES.find((s) => s.name === size) ?? THUMBNAIL_SIZES[0];
    return `${baseUrl}${sizeQuery(spec)}`;
  }

  /**
   * Get thumbnail URL from Bunny.net Storage
   */
  getBunnyUrl(videoId: string, cdnBaseUrl: string, size: 'hd' | 'sd' | 'mobile' | 'thumb' = 'hd'): string {
    const path = `thumbnails/${videoId}/custom.jpg`;
    const baseUrl = `${cdnBaseUrl}/${path}`;

    const spec = THUMBNAIL_SIZES.find((s) => s.name === size) ?? THUMBNAIL_SIZES[0];
    return `${baseUrl}${sizeQuery(spec)}`;
  }
}

/**
 * Singleton instance
 */
export const thumbnailStorage = new ThumbnailStorage();
