/**
 * Thumbnail validation utilities
 * Validates image format, size, and dimensions
 */

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const RECOMMENDED_WIDTH = 1280;
const RECOMMENDED_HEIGHT = 720;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 180;

export interface ThumbnailValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

export interface ImageMetadata {
  width: number;
  height: number;
  mimeType: string;
  size: number;
}

/**
 * Validate base64 encoded image data
 */
export function validateBase64Image(base64Data: string): ThumbnailValidationResult {
  try {
    // Remove data URL prefix if present
    const base64Match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    const actualBase64 = base64Match ? base64Match[2] : base64Data;
    const mimeType = base64Match ? base64Match[1] : '';

    // Validate MIME type
    if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType as any)) {
      return {
        valid: false,
        error: `Invalid image format. Allowed formats: ${ALLOWED_MIME_TYPES.join(', ')}`
      };
    }

    // Decode base64 to check size
    const buffer = base64ToBuffer(actualBase64);

    if (buffer.byteLength > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid base64 image data'
    };
  }
}

/**
 * Validate image buffer
 */
export async function validateImageBuffer(
  buffer: ArrayBuffer,
  filename?: string
): Promise<ThumbnailValidationResult> {
  const warnings: string[] = [];

  // Validate size
  if (buffer.byteLength > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
    };
  }

  // Detect image format from magic bytes
  const uint8 = new Uint8Array(buffer);
  const mimeType = detectMimeType(uint8);

  if (!mimeType) {
    return {
      valid: false,
      error: 'Unable to detect image format'
    };
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
    return {
      valid: false,
      error: `Invalid image format. Allowed formats: ${ALLOWED_MIME_TYPES.join(', ')}`
    };
  }

  // Extract dimensions (simplified - in production use image processing library)
  try {
    const metadata = await getImageMetadata(buffer, mimeType);

    // Orientation-independent: a vertical (9:16) thumbnail for a vertical video is fine
    if (Math.max(metadata.width, metadata.height) < MIN_WIDTH || Math.min(metadata.width, metadata.height) < MIN_HEIGHT) {
      return {
        valid: false,
        error: `Image dimensions too small. Minimum: ${MIN_WIDTH}x${MIN_HEIGHT}px (or ${MIN_HEIGHT}x${MIN_WIDTH}px)`
      };
    }

    // Add warnings for non-optimal dimensions
    if (metadata.width !== RECOMMENDED_WIDTH || metadata.height !== RECOMMENDED_HEIGHT) {
      warnings.push(`Recommended dimensions: ${RECOMMENDED_WIDTH}x${RECOMMENDED_HEIGHT}px`);
    }

    const aspectRatio = metadata.width / metadata.height;
    const recommendedRatio = RECOMMENDED_WIDTH / RECOMMENDED_HEIGHT;

    // A thumbnail should match its video's shape; 16:9 is only the common case
    if (Math.abs(aspectRatio - recommendedRatio) > 0.1) {
      warnings.push('Image aspect ratio differs from 16:9; it should match the video');
    }
  } catch (error) {
    warnings.push('Unable to verify image dimensions');
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToBuffer(base64: string): ArrayBuffer {
  // Remove any whitespace
  const cleaned = base64.replace(/\s/g, '');

  // Decode base64
  const binaryString = atob(cleaned);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

/**
 * Detect MIME type from file signature (magic bytes)
 */
export function detectMimeType(bytes: Uint8Array): string | null {
  // JPEG
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'image/png';
  }

  // WebP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Get image metadata (simplified version)
 * In production, use a proper image processing library
 */
async function getImageMetadata(buffer: ArrayBuffer, mimeType: string): Promise<ImageMetadata> {
  const uint8 = new Uint8Array(buffer);
  let width = 0;
  let height = 0;

  if (mimeType === 'image/png') {
    // PNG dimensions are at bytes 16-23
    width = (uint8[16] << 24) | (uint8[17] << 16) | (uint8[18] << 8) | uint8[19];
    height = (uint8[20] << 24) | (uint8[21] << 16) | (uint8[22] << 8) | uint8[23];
  } else if (mimeType === 'image/jpeg') {
    // JPEG dimensions require parsing JPEG markers
    // Simplified: look for SOF marker (0xFFC0 or 0xFFC2)
    for (let i = 0; i < uint8.length - 10; i++) {
      if (uint8[i] === 0xFF && (uint8[i + 1] === 0xC0 || uint8[i + 1] === 0xC2)) {
        height = (uint8[i + 5] << 8) | uint8[i + 6];
        width = (uint8[i + 7] << 8) | uint8[i + 8];
        break;
      }
    }
  }
  // WebP parsing is more complex, skip for now

  if (!width || !height) {
    throw new Error('Unable to extract image dimensions');
  }

  return {
    width,
    height,
    mimeType,
    size: buffer.byteLength
  };
}

/**
 * Validate image file extension
 */
export function validateFileExtension(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  return ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp';
}
