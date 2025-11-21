/**
 * Server-side logger for api-videos
 * Uses @al-ummah/logger package for centralized logging
 */

import { createLogger } from '@al-ummah/logger';

// Create logger instance for api-videos
const apiLogger = createLogger('api-videos', {
  logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  forceHttpLogging: true, // Force HTTP logging for Cloudflare Workers
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
