/**
 * Logger for processor application
 * Uses @al-ummah/logger package for centralized logging
 */

import { createLogger } from '@al-ummah/logger';

// Create logger instance for processor
const processorLogger = createLogger('processor', {
  // `process` is not defined in Workers at this compatibility date
  logLevel: ((typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined) as 'debug' | 'info' | 'warn' | 'error' | undefined) || 'info',
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
