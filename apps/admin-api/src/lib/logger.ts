/**
 * Server-side logger for admin-api
 * Uses @al-ummah/logger package for centralized logging
 */

import { createLogger } from '@al-ummah/logger';

// Create logger instance for admin-api
// Note: LOG_LEVEL env var not available at module init in Workers
// Using 'info' as default, can be configured via wrangler.toml vars
const apiLogger = createLogger('admin-api', {
  logLevel: 'info',
  forceHttpLogging: true,
});

export const logger = {
  info: (message: string, data?: unknown) => {
    apiLogger.info(message, data);
  },

  warn: (message: string, data?: unknown) => {
    apiLogger.warn(message, data);
  },

  error: (message: string, data?: unknown) => {
    apiLogger.error(message, data);
  },

  debug: (message: string, data?: unknown) => {
    apiLogger.debug(message, data);
  },
};
