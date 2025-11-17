/**
 * Unified logger for Next.js web app
 * - Server-side: Uses @al-ummah/logger for file + console logging
 * - Client-side: Console logging only (browser environment)
 */

import { createLogger } from '@al-ummah/logger';

// Server-side logger instance (only works on server)
const serverLogger = typeof window === 'undefined'
  ? createLogger('web', {
      logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
      forceHttpLogging: true,
    })
  : null;

// Helper to check if running on server
function isServer(): boolean {
  return typeof window === 'undefined';
}

// Unified logger that works on both client and server
export const logger = {
  info: (message: string, data?: any) => {
    if (isServer() && serverLogger) {
      serverLogger.info(message, data);
    } else {
      console.log(`[INFO] ${message}`, data || '');
    }
  },

  warn: (message: string, data?: any) => {
    if (isServer() && serverLogger) {
      serverLogger.warn(message, data);
    } else {
      console.warn(`[WARN] ${message}`, data || '');
    }
  },

  error: (message: string, data?: any) => {
    if (isServer() && serverLogger) {
      serverLogger.error(message, data);
    } else {
      console.error(`[ERROR] ${message}`, data || '');
    }
  },

  debug: (message: string, data?: any) => {
    if (isServer() && serverLogger) {
      serverLogger.debug(message, data);
    } else {
      console.log(`[DEBUG] ${message}`, data || '');
    }
  },
};
