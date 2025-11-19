/**
 * Client-side logger for browser environment
 * Simple console wrapper with consistent formatting
 */

export const logger = {
  info: (message: string, data?: unknown) => {
    console.log(`[INFO] ${message}`, data || '');
  },

  warn: (message: string, data?: unknown) => {
    console.warn(`[WARN] ${message}`, data || '');
  },

  error: (message: string, data?: unknown) => {
    console.error(`[ERROR] ${message}`, data || '');
  },

  debug: (message: string, data?: unknown) => {
    console.log(`[DEBUG] ${message}`, data || '');
  },
};
