/**
 * Magic Byte Validation for File Type Verification
 *
 * SECURITY: This module validates file types by checking magic bytes (file signatures)
 * instead of relying on easily-spoofed Content-Type headers or file extensions.
 *
 * Magic bytes are the first few bytes of a file that identify its format.
 * This prevents attackers from uploading malicious files disguised as valid media.
 */

/**
 * Video file magic byte signatures
 * Each entry contains: [offset, signature bytes, mime type, description]
 */
const VIDEO_SIGNATURES = [
  // WebM and Matroska (MKV) share the EBML header; the DocType further in tells them apart (detectEbml)
  { offset: 0, signature: [0x1A, 0x45, 0xDF, 0xA3], mimeType: 'video/webm', description: 'WebM/Matroska (EBML)' },

  // QuickTime/MOV files: 'ftyp' then the 'qt  ' brand. Before the generic MP4 entry, which also matches 'ftyp'
  { offset: 4, signature: [0x66, 0x74, 0x79, 0x70, 0x71, 0x74], mimeType: 'video/quicktime', description: 'QuickTime MOV' },

  // M4V (iTunes video) is an MP4 with the 'M4V ' brand
  { offset: 4, signature: [0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x56], mimeType: 'video/x-m4v', description: 'M4V' },

  // MP4 files (ISO Base Media File Format): 'ftyp' with any other brand (isom, mp42, MSNV, avc1, ...)
  { offset: 4, signature: [0x66, 0x74, 0x79, 0x70], mimeType: 'video/mp4', description: 'MP4/MPEG-4' },
] as const;

/**
 * Image file magic byte signatures
 */
const IMAGE_SIGNATURES = [
  // JPEG
  { offset: 0, signature: [0xFF, 0xD8, 0xFF], mimeType: 'image/jpeg', description: 'JPEG' },

  // PNG
  { offset: 0, signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mimeType: 'image/png', description: 'PNG' },

  // GIF
  { offset: 0, signature: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], mimeType: 'image/gif', description: 'GIF87a' },
  { offset: 0, signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], mimeType: 'image/gif', description: 'GIF89a' },

  // WebP
  { offset: 0, signature: [0x52, 0x49, 0x46, 0x46], mimeType: 'image/webp', description: 'WebP (RIFF)' },
] as const;

/**
 * Validation result
 */
export interface MagicByteValidationResult {
  isValid: boolean;
  detectedMimeType?: string;
  detectedFormat?: string;
  providedMimeType?: string;
  mimeTypeMismatch?: boolean;
  error?: string;
}

/**
 * Check if bytes match a signature at a specific offset
 */
function matchesSignature(
  buffer: Uint8Array,
  offset: number,
  signature: readonly number[]
): boolean {
  if (buffer.length < offset + signature.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i++) {
    if (buffer[offset + i] !== signature[i]) {
      return false;
    }
  }

  return true;
}

/** Other names for a video type that browsers and tools send; they are the same format, not a mismatch */
const VIDEO_TYPE_ALIASES: Record<string, string> = {
  'video/mov': 'video/quicktime',
  'video/avi': 'video/x-msvideo',
  'video/msvideo': 'video/x-msvideo',
  'video/vnd.avi': 'video/x-msvideo',
  'video/m4v': 'video/x-m4v',
  'video/matroska': 'video/x-matroska',
};

/** True when the EBML header (read from `buffer`) declares DocType "matroska"; "webm" or an unreadable one is WebM */
function isMatroskaDocType(buffer: Uint8Array): boolean {
  // DocType (0x4282) is a few bytes into the header; 'matroska' is 8 ASCII bytes
  const text = String.fromCharCode(...buffer.subarray(0, Math.min(buffer.length, 64)));
  return text.includes('matroska');
}

function result(detectedMimeType: string, detectedFormat: string, providedMimeType?: string): MagicByteValidationResult {
  const provided = providedMimeType ? (VIDEO_TYPE_ALIASES[providedMimeType.toLowerCase()] ?? providedMimeType.toLowerCase()) : undefined;
  // An empty or generic type from the browser says nothing, so it cannot disagree
  const generic = !provided || provided === 'application/octet-stream';
  return {
    isValid: true,
    detectedMimeType,
    detectedFormat,
    providedMimeType,
    // MP4, M4V and MOV are one family (ISO base media): a mislabel between them is not worth a warning
    mimeTypeMismatch: !generic && provided !== detectedMimeType && !(isIsoFamily(provided) && isIsoFamily(detectedMimeType)),
  };
}

function isIsoFamily(type: string): boolean {
  return type === 'video/mp4' || type === 'video/x-m4v' || type === 'video/quicktime';
}

/**
 * Validate video file by magic bytes
 *
 * @param fileData - First 64 bytes of the file (12 are enough except to tell Matroska from WebM)
 * @param providedMimeType - MIME type from Content-Type header (optional)
 * @returns Validation result with detected format
 *
 * @example
 * ```typescript
 * const file = formData.get('file') as File;
 * const arrayBuffer = await file.arrayBuffer();
 * const bytes = new Uint8Array(arrayBuffer.slice(0, 12));
 *
 * const result = validateVideoMagicBytes(bytes, file.type);
 * if (!result.isValid) {
 *   return c.json({ error: result.error }, 400);
 * }
 * ```
 */
export function validateVideoMagicBytes(
  fileData: Uint8Array | ArrayBuffer,
  providedMimeType?: string
): MagicByteValidationResult {
  const buffer = fileData instanceof Uint8Array
    ? fileData
    : new Uint8Array(fileData);

  // Check minimum file size
  if (buffer.length < 12) {
    return {
      isValid: false,
      error: 'File too small to validate (minimum 12 bytes required)',
    };
  }

  // AVI: 'RIFF' <size> 'AVI '. Any other RIFF file (WAV, WebP) is not a video
  if (matchesSignature(buffer, 0, [0x52, 0x49, 0x46, 0x46]) && matchesSignature(buffer, 8, [0x41, 0x56, 0x49, 0x20])) {
    return result('video/x-msvideo', 'AVI', providedMimeType);
  }

  // Check against all video signatures
  for (const sig of VIDEO_SIGNATURES) {
    if (matchesSignature(buffer, sig.offset, sig.signature)) {
      if (sig.mimeType === 'video/webm') {
        const matroska = isMatroskaDocType(buffer);
        return result(matroska ? 'video/x-matroska' : 'video/webm', matroska ? 'Matroska (MKV)' : 'WebM', providedMimeType);
      }
      return result(sig.mimeType, sig.description, providedMimeType);
    }
  }

  return {
    isValid: false,
    error: `Invalid video file signature. File does not match any known video format.`,
    providedMimeType,
  };
}

/**
 * Validate image file by magic bytes
 *
 * @param fileData - First 12+ bytes of the file
 * @param providedMimeType - MIME type from Content-Type header (optional)
 * @returns Validation result with detected format
 */
export function validateImageMagicBytes(
  fileData: Uint8Array | ArrayBuffer,
  providedMimeType?: string
): MagicByteValidationResult {
  const buffer = fileData instanceof Uint8Array
    ? fileData
    : new Uint8Array(fileData);

  // Check minimum file size
  if (buffer.length < 8) {
    return {
      isValid: false,
      error: 'File too small to validate (minimum 8 bytes required)',
    };
  }

  // Check against all image signatures
  for (const sig of IMAGE_SIGNATURES) {
    if (matchesSignature(buffer, sig.offset, sig.signature)) {
      const mimeTypeMismatch = providedMimeType
        ? !providedMimeType.includes(sig.mimeType) && !sig.mimeType.includes(providedMimeType)
        : false;

      return {
        isValid: true,
        detectedMimeType: sig.mimeType,
        detectedFormat: sig.description,
        providedMimeType,
        mimeTypeMismatch,
      };
    }
  }

  // Special check for WebP (need to verify 'WEBP' after RIFF)
  if (matchesSignature(buffer, 0, [0x52, 0x49, 0x46, 0x46]) && buffer.length >= 12) {
    if (matchesSignature(buffer, 8, [0x57, 0x45, 0x42, 0x50])) { // 'WEBP'
      return {
        isValid: true,
        detectedMimeType: 'image/webp',
        detectedFormat: 'WebP',
        providedMimeType,
        mimeTypeMismatch: providedMimeType ? !providedMimeType.includes('webp') : false,
      };
    }
  }

  return {
    isValid: false,
    error: `Invalid image file signature. File does not match any known image format.`,
    providedMimeType,
  };
}

/**
 * Helper to read first N bytes from a File or Blob
 *
 * @param file - File or Blob to read
 * @param bytesToRead - Number of bytes to read (default: 12)
 * @returns Promise<Uint8Array>
 */
export async function readFileHeader(
  file: File | Blob,
  bytesToRead = 12
): Promise<Uint8Array> {
  const slice = file.slice(0, bytesToRead);
  const arrayBuffer = await slice.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
