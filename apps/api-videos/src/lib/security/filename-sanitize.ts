/**
 * Filename Sanitization for Path Traversal Prevention
 *
 * SECURITY: This module sanitizes user-provided filenames to prevent:
 * - Path traversal attacks (../, ..\, etc.)
 * - Directory traversal via absolute paths
 * - Special characters that could break file systems
 * - Excessively long filenames
 * - Hidden files (leading dots)
 */

/**
 * Sanitization options
 */
export interface SanitizeOptions {
  /**
   * Maximum filename length (default: 255)
   */
  maxLength?: number;

  /**
   * Convert to lowercase (default: true)
   */
  toLowerCase?: boolean;

  /**
   * Replace spaces with dashes (default: true)
   */
  replaceSpaces?: boolean;

  /**
   * Allowed file extensions (if provided, will validate)
   */
  allowedExtensions?: string[];

  /**
   * Preserve original extension (default: true)
   */
  preserveExtension?: boolean;
}

/**
 * Sanitize filename to prevent path traversal and other attacks
 *
 * @param filename - Original filename from user input
 * @param options - Sanitization options
 * @returns Sanitized filename safe for file system operations
 *
 * @example
 * ```typescript
 * // Basic sanitization
 * sanitizeFilename('../../etc/passwd') // Returns: 'etc-passwd'
 * sanitizeFilename('Hello World.jpg') // Returns: 'hello-world.jpg'
 *
 * // With allowed extensions
 * sanitizeFilename('image.exe', { allowedExtensions: ['.jpg', '.png'] })
 * // Throws error: "File extension '.exe' is not allowed"
 *
 * // Preserve uppercase
 * sanitizeFilename('MyFile.JPG', { toLowerCase: false }) // Returns: 'MyFile.JPG'
 * ```
 */
export function sanitizeFilename(
  filename: string,
  options: SanitizeOptions = {}
): string {
  const {
    maxLength = 255,
    toLowerCase = true,
    replaceSpaces = true,
    allowedExtensions = [],
    preserveExtension = true,
  } = options;

  // 1. Extract extension before sanitization
  let extension = '';
  let baseName = filename;

  if (preserveExtension) {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex > 0) {
      extension = filename.substring(lastDotIndex);
      baseName = filename.substring(0, lastDotIndex);

      // Validate extension if whitelist provided
      if (allowedExtensions.length > 0) {
        const normalizedExt = extension.toLowerCase();
        const allowed = allowedExtensions.map(ext => ext.toLowerCase());

        if (!allowed.includes(normalizedExt)) {
          throw new Error(
            `File extension '${extension}' is not allowed. Allowed: ${allowedExtensions.join(', ')}`
          );
        }
      }
    }
  } else {
    // Remove extension entirely
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex > 0) {
      baseName = filename.substring(0, lastDotIndex);
    }
  }

  // 2. Remove path separators and parent directory references
  let sanitized = baseName
    .replace(/\\/g, '-')  // Replace backslashes
    .replace(/\//g, '-')  // Replace forward slashes
    .replace(/\.\./g, '') // Remove parent directory references
    .replace(/^\.+/, '')  // Remove leading dots (hidden files)
    .trim();

  // 3. Remove or replace special characters
  // Allow: alphanumeric, dash, underscore, period
  sanitized = sanitized.replace(/[^a-zA-Z0-9-_.]/g, '-');

  // 4. Replace multiple consecutive dashes/underscores
  sanitized = sanitized
    .replace(/-+/g, '-')
    .replace(/_+/g, '_')
    .replace(/\.+/g, '.');

  // 5. Replace spaces if requested
  if (replaceSpaces) {
    sanitized = sanitized.replace(/\s+/g, '-');
  }

  // 6. Convert to lowercase if requested
  if (toLowerCase) {
    sanitized = sanitized.toLowerCase();
    extension = extension.toLowerCase();
  }

  // 7. Remove leading/trailing dashes and underscores
  sanitized = sanitized.replace(/^[-_]+|[-_]+$/g, '');

  // 8. If empty after sanitization, generate a safe default
  if (!sanitized) {
    sanitized = 'file';
  }

  // 9. Reconstruct filename with extension
  let finalFilename = sanitized + extension;

  // 10. Enforce maximum length (reserve space for extension)
  if (finalFilename.length > maxLength) {
    const maxBaseLength = maxLength - extension.length;
    if (maxBaseLength > 0) {
      sanitized = sanitized.substring(0, maxBaseLength);
      finalFilename = sanitized + extension;
    } else {
      // Extension alone is too long - truncate it
      finalFilename = finalFilename.substring(0, maxLength);
    }
  }

  return finalFilename;
}

/**
 * Generate a unique filename with UUID prefix
 *
 * @param originalFilename - Original filename from user
 * @param options - Sanitization options
 * @returns Unique filename: {uuid}-{sanitized-name}.{ext}
 *
 * @example
 * ```typescript
 * generateUniqueFilename('My Photo.jpg')
 * // Returns: '550e8400-e29b-41d4-a716-446655440000-my-photo.jpg'
 * ```
 */
export function generateUniqueFilename(
  originalFilename: string,
  options: SanitizeOptions = {}
): string {
  const sanitized = sanitizeFilename(originalFilename, options);

  // Generate UUID (using crypto.randomUUID if available)
  const uuid = crypto.randomUUID();

  // Extract extension
  const lastDotIndex = sanitized.lastIndexOf('.');
  if (lastDotIndex > 0) {
    const baseName = sanitized.substring(0, lastDotIndex);
    const extension = sanitized.substring(lastDotIndex);
    return `${uuid}-${baseName}${extension}`;
  }

  return `${uuid}-${sanitized}`;
}

/**
 * Validate filename without modifying it
 *
 * @param filename - Filename to validate
 * @returns Object with validation result
 *
 * @example
 * ```typescript
 * validateFilename('../../etc/passwd')
 * // Returns: { isValid: false, errors: ['Contains path traversal sequences'] }
 *
 * validateFilename('safe-file.jpg')
 * // Returns: { isValid: true, errors: [] }
 * ```
 */
export function validateFilename(filename: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for path traversal
  if (filename.includes('..') || filename.includes('./') || filename.includes('.\\')) {
    errors.push('Contains path traversal sequences');
  }

  // Check for path separators
  if (filename.includes('/') || filename.includes('\\')) {
    errors.push('Contains path separators');
  }

  // Check for leading dots (hidden files)
  if (filename.startsWith('.')) {
    errors.push('Filename cannot start with a dot (hidden files not allowed)');
  }

  // Check for null bytes
  if (filename.includes('\0')) {
    errors.push('Contains null bytes');
  }

  // Check for control characters
  if (/[\x00-\x1F\x7F]/.test(filename)) {
    errors.push('Contains control characters');
  }

  // Check length
  if (filename.length === 0) {
    errors.push('Filename is empty');
  }

  if (filename.length > 255) {
    errors.push('Filename exceeds maximum length (255 characters)');
  }

  // Check for dangerous extensions (common executable/script types)
  const dangerousExtensions = [
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr',
    '.vbs', '.js', '.jar', '.sh', '.ps1', '.app',
  ];

  const lowerFilename = filename.toLowerCase();
  for (const ext of dangerousExtensions) {
    if (lowerFilename.endsWith(ext)) {
      errors.push(`Dangerous file extension: ${ext}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a safe path for file storage
 *
 * @param basePath - Base directory (e.g., '/uploads', '/images')
 * @param subdirectory - Optional subdirectory (will be sanitized)
 * @param filename - Filename (will be sanitized)
 * @returns Safe file path
 *
 * @example
 * ```typescript
 * generateSafePath('/uploads', 'user-123', 'photo.jpg')
 * // Returns: '/uploads/user-123/photo.jpg'
 *
 * generateSafePath('/uploads', '../../etc', 'passwd')
 * // Returns: '/uploads/etc/passwd' (path traversal removed)
 * ```
 */
export function generateSafePath(
  basePath: string,
  subdirectory: string | null,
  filename: string
): string {
  // Sanitize each component
  const safeFilename = sanitizeFilename(filename);

  if (subdirectory) {
    const safeSubdirectory = sanitizeFilename(subdirectory, {
      preserveExtension: false,
    });

    // Ensure base path doesn't end with slash
    const cleanBasePath = basePath.replace(/\/+$/, '');

    return `${cleanBasePath}/${safeSubdirectory}/${safeFilename}`;
  }

  const cleanBasePath = basePath.replace(/\/+$/, '');
  return `${cleanBasePath}/${safeFilename}`;
}
