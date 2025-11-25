/**
 * Logger for websocket-server application
 * Uses @al-ummah/logger package for centralized logging
 */

import { createLogger } from '@al-ummah/logger';

// Create logger instance for websocket-server
// Note: In Cloudflare Workers, use environment bindings instead of process.env
const wsLogger = createLogger('websocket', {
  logLevel: 'info', // Default level, can be overridden via Cloudflare env vars
  forceHttpLogging: true, // Force HTTP logging for Cloudflare Workers
});

export const logger = {
  info: (message: string, data?: unknown) => {
    wsLogger.info(message, data);
  },

  warn: (message: string, data?: unknown) => {
    wsLogger.warn(message, data);
  },

  error: (message: string, data?: unknown) => {
    wsLogger.error(message, data);
  },

  debug: (message: string, data?: unknown) => {
    wsLogger.debug(message, data);
  },
};
