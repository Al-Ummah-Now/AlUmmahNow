/**
 * Server-side logger using @al-ummah/logger package
 * For use in server components and server actions only
 */

import { createLogger } from '@al-ummah/logger';

const serverLogger = createLogger('web', {
  logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  forceHttpLogging: true,
});

export const logger = {
  info: (message: string, data?: unknown) => {
    serverLogger.info(message, data);
  },

  warn: (message: string, data?: unknown) => {
    serverLogger.warn(message, data);
  },

  error: (message: string, data?: unknown) => {
    serverLogger.error(message, data);
  },

  debug: (message: string, data?: unknown) => {
    serverLogger.debug(message, data);
  },
};
