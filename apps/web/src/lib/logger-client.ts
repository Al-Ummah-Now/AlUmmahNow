/**
 * Browser logger. Logging policy (docs/operations/logging.md): on a production
 * host the console shows nothing below warn, whatever the build says; QA/stage/
 * preview hosts honour NEXT_PUBLIC_LOG_LEVEL (default warn); `next dev` shows debug.
 * Data is redacted (tokens, emails, bodies) before it reaches the console.
 * logger.error() also goes to the admin Errors page (forwardLoggedError).
 */
/* eslint-disable no-console -- the one place browser code writes to the console */

import { isLogLevel, levelEnabled, redact, redactString, type LogLevel } from '@al-ummah/logger/policy';
import { forwardLoggedError } from '@/lib/errors/reporter';

/** Hosts that are not production: localhost, *.qa.*, *.stage.*, *.staging.*, *.preview.*, workers.dev. */
const NON_PRODUCTION_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|(^|\.)(qa|stage|staging|preview)\.|\.workers\.dev$/i;

export function clientLogLevel(
  hostname: string = typeof location !== 'undefined' ? location.hostname : '',
  configured: string | undefined = process.env.NEXT_PUBLIC_LOG_LEVEL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): LogLevel {
  if (nodeEnv === 'development') return isLogLevel(configured) ? configured : 'debug';
  const level: LogLevel = isLogLevel(configured) ? configured : 'warn';
  // Production host: never below warn
  if (!NON_PRODUCTION_HOST.test(hostname) && !levelEnabled(level, 'warn')) return 'warn';
  return level;
}

function write(level: LogLevel, message: string, data?: unknown): void {
  if (!levelEnabled(level, clientLogLevel())) return;
  // Constant '%s' format: a message carrying user input is never read as a format string
  const line = `[${level.toUpperCase()}] ${redactString(String(message))}`;
  const args = data === undefined ? ['%s', line] : ['%s', line, redact(data)];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.debug(...args);
}

export const logger = {
  trace: (message: string, data?: unknown) => write('trace', message, data),
  debug: (message: string, data?: unknown) => write('debug', message, data),
  info: (message: string, data?: unknown) => write('info', message, data),
  warn: (message: string, data?: unknown) => write('warn', message, data),
  /** Also reported to the admin Errors page at every level (the reporter scrubs it; lib/errors/reporter.ts). */
  error: (message: string, data?: unknown) => {
    write('error', message, data);
    forwardLoggedError(message, data);
  },
};
