/**
 * File logger for local development
 * Logs to both console and a log file via API route
 * Log file: /tmp/al-ummah-web.log
 */

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: any;
}

async function writeLog(entry: LogEntry) {
  // Always log to console
  const consoleMsg = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;

  switch (entry.level) {
    case 'error':
      console.error(consoleMsg, entry.data || '');
      break;
    case 'warn':
      console.warn(consoleMsg, entry.data || '');
      break;
    default:
      console.log(consoleMsg, entry.data || '');
  }

  // Write to file via API route (only in browser)
  if (typeof window !== 'undefined') {
    try {
      await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {
        // Silently fail if logging endpoint doesn't respond
      });
    } catch (error) {
      // Ignore logging errors
    }
  }
}

export const logger = {
  info: (message: string, data?: any) => {
    writeLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      data,
    });
  },

  warn: (message: string, data?: any) => {
    writeLog({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      data,
    });
  },

  error: (message: string, data?: any) => {
    writeLog({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      data,
    });
  },

  debug: (message: string, data?: any) => {
    writeLog({
      timestamp: new Date().toISOString(),
      level: 'debug',
      message,
      data,
    });
  },
};
