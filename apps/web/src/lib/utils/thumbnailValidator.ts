/**
 * Thumbnail validation utilities for frontend
 * Validates thumbnail files before upload
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

export interface ThumbnailDimensions {
  width: number;
  height: number;
}

/**
 * Validate thumbnail file
 * @param file - File to validate
 * @returns Promise<ThumbnailValidationResult> - Validation result
 */
export async function validateThumbnailFile(file: File): Promise<ThumbnailValidationResult> {
  const warnings: string[] = [];

  // Check file type
  if (!ALLOWED_MIME_TYPES.includes(file.type as any)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: JPEG, PNG, WebP`
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
    };
  }

  // Check file name
  if (!validateFileExtension(file.name)) {
    warnings.push('File extension does not match content type');
  }

  // Check image dimensions
  try {
    const dimensions = await getImageDimensions(file);

    if (dimensions.width < MIN_WIDTH || dimensions.height < MIN_HEIGHT) {
      return {
        valid: false,
        error: `Image dimensions too small. Minimum: ${MIN_WIDTH}x${MIN_HEIGHT}px`
      };
    }

    // Check if dimensions match recommended
    if (dimensions.width !== RECOMMENDED_WIDTH || dimensions.height !== RECOMMENDED_HEIGHT) {
      warnings.push(`Recommended dimensions: ${RECOMMENDED_WIDTH}x${RECOMMENDED_HEIGHT}px (current: ${dimensions.width}x${dimensions.height}px)`);
    }

    // Check aspect ratio
    const aspectRatio = dimensions.width / dimensions.height;
    const recommendedRatio = RECOMMENDED_WIDTH / RECOMMENDED_HEIGHT;

    if (Math.abs(aspectRatio - recommendedRatio) > 0.1) {
      warnings.push('Image aspect ratio differs from recommended 16:9');
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
 * Get image dimensions
 * @param file - Image file
 * @returns Promise<ThumbnailDimensions> - Image dimensions
 */
export async function getImageDimensions(file: File): Promise<ThumbnailDimensions> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Validate file extension
 * @param filename - Filename to validate
 * @returns boolean - True if extension is valid
 */
export function validateFileExtension(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  return ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp';
}

/**
 * Convert File to base64
 * @param file - File to convert
 * @returns Promise<string> - Base64 encoded file
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Resize image to fit within max dimensions while maintaining aspect ratio
 * @param file - Image file to resize
 * @param maxWidth - Maximum width
 * @param maxHeight - Maximum height
 * @param quality - JPEG quality (0-1)
 * @returns Promise<string> - Base64 encoded resized image
 */
export async function resizeImage(
  file: File,
  maxWidth: number = RECOMMENDED_WIDTH,
  maxHeight: number = RECOMMENDED_HEIGHT,
  quality: number = 0.9
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Calculate dimensions maintaining aspect ratio
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = width * ratio;
        height = height * ratio;
      }

      canvas.width = width;
      canvas.height = height;

      // Draw and convert to base64
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Format file size for display
 * @param bytes - File size in bytes
 * @returns string - Formatted file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Get maximum allowed file size
 * @returns number - Maximum file size in bytes
 */
export function getMaxFileSize(): number {
  return MAX_FILE_SIZE;
}

/**
 * Get recommended dimensions
 * @returns ThumbnailDimensions - Recommended dimensions
 */
export function getRecommendedDimensions(): ThumbnailDimensions {
  return {
    width: RECOMMENDED_WIDTH,
    height: RECOMMENDED_HEIGHT
  };
}
