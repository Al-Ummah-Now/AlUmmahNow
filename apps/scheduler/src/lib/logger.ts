/**
 * Logger for scheduler application
 * Uses @al-ummah/logger package for centralized logging
 */

import { createLogger } from '@al-ummah/logger';

// Create logger instance for scheduler
// Note: In Cloudflare Workers, use environment bindings instead of process.env
const schedulerLogger = createLogger('scheduler', {
  logLevel: 'info', // Default level, can be overridden via Cloudflare env vars
  forceHttpLogging: true, // Force HTTP logging for Cloudflare Workers
});

export const logger = {
  info: (message: string, data?: unknown) => {
    schedulerLogger.info(message, data);
  },

  warn: (message: string, data?: unknown) => {
    schedulerLogger.warn(message, data);
  },

  error: (message: string, data?: unknown) => {
    schedulerLogger.error(message, data);
  },

  debug: (message: string, data?: unknown) => {
    schedulerLogger.debug(message, data);
  },
};
