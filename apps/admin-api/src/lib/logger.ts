/**
 * Server-side logger for admin-api
 * Uses @al-ummah/logger package for centralized logging
 */

import { createLogger } from '@al-ummah/logger';

// Type-safe access to environment variable
declare const process: { env: Record<string, string | undefined> };

// Create logger instance for admin-api
const apiLogger = createLogger('admin-api', {
  logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
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
