/**
 * Thumbnail processing service
 * Handles image processing, resizing, and optimization
 *
 * Note: Cloudflare Workers doesn't support heavy image processing libraries like sharp.
 * We use Bunny.net's Image Optimizer for resizing or store original in R2.
 */

import { base64ToBuffer, validateBase64Image, validateImageBuffer } from './validator';

export interface ThumbnailSize {
  name: string;
  width: number;
  height: number;
  quality: number;
}

/**
 * Size variants by width. `height` is the 16:9 reference only: the variant
 * URLs ask for a width and keep the image's own aspect ratio, so a vertical
 * or square thumbnail is never cropped or squashed to 16:9 (2026-11-10).
 */
export const THUMBNAIL_SIZES: ThumbnailSize[] = [
  { name: 'hd', width: 1280, height: 720, quality: 90 },
  { name: 'sd', width: 640, height: 360, quality: 85 },
  { name: 'mobile', width: 320, height: 180, quality: 80 },
  { name: 'thumb', width: 120, height: 90, quality: 75 },
];

/** Image Optimizer query for one size: width and quality, aspect ratio kept. */
export function sizeQuery(size: ThumbnailSize): string {
  return `?width=${size.width}&quality=${size.quality}`;
}

/** hd/sd/mobile/thumb variant URLs of one stored image. */
export function thumbnailSizeUrls(baseUrl: string): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const size of THUMBNAIL_SIZES) urls[size.name] = `${baseUrl}${sizeQuery(size)}`;
  return urls;
}

export interface ProcessedThumbnail {
  original: ArrayBuffer;
  mimeType: string;
  filename: string;
}

export class ThumbnailProcessor {
  /**
   * Process base64 thumbnail data
   */
  async processBase64(
    base64Data: string,
    filename: string = 'thumbnail.jpg'
  ): Promise<ProcessedThumbnail> {
    // Validate base64 data
    const validation = validateBase64Image(base64Data);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid thumbnail data');
    }

    // Extract actual base64 and MIME type
    const base64Match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    const actualBase64 = base64Match ? base64Match[2] : base64Data;
    const mimeType = base64Match ? base64Match[1] : 'image/jpeg';

    // Convert to buffer
    const buffer = base64ToBuffer(actualBase64);

    // Validate buffer
    const bufferValidation = await validateImageBuffer(buffer, filename);
    if (!bufferValidation.valid) {
      throw new Error(bufferValidation.error || 'Invalid image buffer');
    }

    return {
      original: buffer,
      mimeType,
      filename
    };
  }

  /**
   * Generate Bunny.net CDN URLs with Image Optimizer parameters
   * Bunny.net can resize images on-the-fly using query parameters
   *
   * Format: https://cdn.bunny.net/path/to/image.jpg?width=640&quality=85 (aspect ratio kept)
   */
  generateBunnyUrls(baseUrl: string): Record<string, string> {
    const urls = thumbnailSizeUrls(baseUrl);

    // Also include original URL
    urls.original = baseUrl;

    return urls;
  }

  /**
   * Generate R2 URLs for different thumbnail sizes
   * When using R2, we store the original and use Bunny.net as CDN with Image Optimizer
   */
  generateR2Urls(r2BaseUrl: string, videoId: string): Record<string, string> {
    const baseUrl = `${r2BaseUrl}/thumbnails/${videoId}/original.jpg`;
    const urls = thumbnailSizeUrls(baseUrl);

    urls.original = baseUrl;

    return urls;
  }

  /**
   * Get optimal thumbnail size URL based on context
   */
  getOptimalSize(
    thumbnailSizes: Record<string, string> | undefined,
    context: 'card' | 'list' | 'detail' | 'mobile' = 'card'
  ): string {
    if (!thumbnailSizes) {
      return '';
    }

    switch (context) {
      case 'detail':
        return thumbnailSizes.hd || thumbnailSizes.original || '';
      case 'card':
        return thumbnailSizes.sd || thumbnailSizes.hd || thumbnailSizes.original || '';
      case 'list':
        return thumbnailSizes.mobile || thumbnailSizes.sd || thumbnailSizes.original || '';
      case 'mobile':
        return thumbnailSizes.thumb || thumbnailSizes.mobile || thumbnailSizes.original || '';
      default:
        return thumbnailSizes.sd || thumbnailSizes.original || '';
    }
  }
}

/**
 * Singleton instance
 */
export const thumbnailProcessor = new ThumbnailProcessor();
