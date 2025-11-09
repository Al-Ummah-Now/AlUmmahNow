/**
 * Centralized logging utility for the application
 *
 * Usage:
 * ```ts
 * import { logger } from '@/lib/utils/logger';
 *
 * logger.debug('Fetching data', { userId, limit });
 * logger.info('User logged in', { userId });
 * logger.warn('API rate limit approaching', { remaining: 10 });
 * logger.error('Failed to fetch data', error);
 * ```
 */

export const logger = {
  /**
   * Log debug information (only in development)
   * @param message - Debug message
   * @param args - Additional data to log
   */
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  },

  /**
   * Log informational messages
   * @param message - Info message
   * @param args - Additional data to log
   */
  info: (message: string, ...args: unknown[]) => {
    console.log(`[INFO] ${message}`, ...args);
  },

  /**
   * Log warning messages
   * @param message - Warning message
   * @param args - Additional data to log
   */
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[WARN] ${message}`, ...args);
  },

  /**
   * Log error messages
   * @param message - Error message
   * @param args - Additional data to log (typically Error objects)
   */
  error: (message: string, ...args: unknown[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  }
};
