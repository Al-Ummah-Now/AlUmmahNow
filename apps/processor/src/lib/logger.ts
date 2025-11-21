/**
 * Logger for processor application
 * Uses @al-ummah/logger package for centralized logging
 */

import { createLogger } from '@al-ummah/logger';

// Create logger instance for processor
const processorLogger = createLogger('processor', {
  logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  forceHttpLogging: true, // Force HTTP logging for Cloudflare Workers
});

export const logger = {
  info: (message: string, data?: unknown) => {
    processorLogger.info(message, data);
  },

  warn: (message: string, data?: unknown) => {
    processorLogger.warn(message, data);
  },

  error: (message: string, data?: unknown) => {
    processorLogger.error(message, data);
  },

  debug: (message: string, data?: unknown) => {
    processorLogger.debug(message, data);
  },
};
