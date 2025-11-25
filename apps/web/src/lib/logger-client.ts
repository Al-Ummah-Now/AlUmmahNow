/**
 * Client-side logger for browser environment
 * Console wrapper with consistent formatting and level filtering
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get the minimum log level from environment or default to 'info' in production
 */
function getMinLogLevel(): LogLevel {
  // In production, default to 'warn' to reduce noise
  // In development, default to 'debug' to see everything
  const isDev = process.env.NODE_ENV === 'development';
  const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel | undefined;

  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel;
  }

  return isDev ? 'debug' : 'warn';
}

/**
 * Check if a log level should be output based on minimum level
 */
function shouldLog(level: LogLevel): boolean {
  const minLevel = getMinLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

export const logger = {
  info: (message: string, data?: unknown) => {
    if (shouldLog('info')) {
      console.log(`[INFO] ${message}`, data !== undefined ? data : '');
    }
  },

  warn: (message: string, data?: unknown) => {
    if (shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, data !== undefined ? data : '');
    }
  },

  error: (message: string, data?: unknown) => {
    if (shouldLog('error')) {
      console.error(`[ERROR] ${message}`, data !== undefined ? data : '');
    }
  },

  debug: (message: string, data?: unknown) => {
    if (shouldLog('debug')) {
      console.log(`[DEBUG] ${message}`, data !== undefined ? data : '');
    }
  },
};
