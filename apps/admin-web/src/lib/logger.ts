/**
 * Server-side logger for admin-web
 * Uses @al-ummah/logger package for centralized logging
 */

import { createLogger } from '@al-ummah/logger';

// Create logger instance for admin-web
const adminWebLogger = createLogger('admin-web', {
  logLevel: 'debug',
  forceHttpLogging: true,
});

export const logger = {
  info: (message: string, data?: unknown) => {
    adminWebLogger.info(message, data);
  },

  warn: (message: string, data?: unknown) => {
    adminWebLogger.warn(message, data);
  },

  error: (message: string, data?: unknown) => {
    adminWebLogger.error(message, data);
  },

  debug: (message: string, data?: unknown) => {
    adminWebLogger.debug(message, data);
  },
};
