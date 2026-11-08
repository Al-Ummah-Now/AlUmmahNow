/**
 * Log levels in order of severity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /**
   * Minimum log level to output
   * @default 'info'
   */
  logLevel?: LogLevel;

  /**
   * App name (used for log file naming and HTTP logging)
   * @example 'api-videos', 'websocket-server', 'processor'
   */
  appName?: string;

  /**
   * Whether to enable console logging
   * @default true
   */
  consoleLogging?: boolean;

  /**
   * Whether to enable file logging
   * @default true
   */
  fileLogging?: boolean;

  /**
   * Log service URL for HTTP logging (local development only).
   *
   * HTTP shipping is opt-in: it runs only when this is set, when the
   * LOG_SERVICE_URL environment variable is set, or when NODE_ENV is
   * "development" (then http://localhost:3089). Deployed workers used to
   * POST every log line to localhost:3089, a subrequest that always failed.
   */
  logServiceUrl?: string;

  /**
   * Force HTTP logging even in Node.js environments
   * Useful for local development when you want all apps to log to a central service
   * @default false
   */
  forceHttpLogging?: boolean;
}

function readEnv(name: string): string | undefined {
  try {
    // process.env exists in Node and in Workers with nodejs_compat
    return typeof process !== 'undefined' ? process.env?.[name] : undefined;
  } catch {
    return undefined;
  }
}

/** The log-service URL to ship to, or null when HTTP shipping is off. */
export function resolveLogServiceUrl(configured?: string): string | null {
  if (configured) return configured;
  const fromEnv = readEnv('LOG_SERVICE_URL');
  if (fromEnv) return fromEnv;
  return readEnv('NODE_ENV') === 'development' ? 'http://localhost:3089' : null;
}

/**
 * Logger class for Al Ummah Now applications
 *
 * Features:
 * - Console logging (always available)
 * - File logging (local development only)
 * - Structured log format with timestamps
 * - Configurable log levels
 * - Non-blocking async file writes
 *
 * @example
 * ```typescript
 * const logger = new Logger({
 *   logLevel: 'debug',
 *   logFilePath: 'logs/api-videos.log'
 * });
 *
 * logger.info('Server started', { port: 3000 });
 * logger.error('Failed to connect', error);
 * ```
 */
export class Logger {
  private logLevel: LogLevel;
  private appName: string;
  private consoleLogging: boolean;
  private fileLogging: boolean;
  private logServiceUrl: string | null;
  private useHttpLogging: boolean = false;

  constructor(config: LoggerConfig = {}) {
    this.logLevel = config.logLevel ?? 'info';
    this.appName = config.appName ?? 'unknown';
    this.consoleLogging = config.consoleLogging ?? true;
    this.fileLogging = config.fileLogging ?? true;
    this.logServiceUrl = resolveLogServiceUrl(config.logServiceUrl);

    // Detect environment
    // Use HTTP logging for Workers environments OR if explicitly forced
    // Use direct file I/O for Next.js and other Node.js environments (unless forced)
    this.useHttpLogging = config.forceHttpLogging ?? this.isWorkersEnvironment();
  }

  /**
   * Detect if running in Cloudflare Workers environment
   * Workers uses workerd runtime which has unenv polyfills
   */
  private isWorkersEnvironment(): boolean {
    try {
      // Check for Workers-specific global objects
      // @ts-ignore - These globals exist in Workers but not in Node.js
      if (typeof globalThis.WebSocketPair !== 'undefined') {
        return true;
      }

      // @ts-ignore
      if (typeof globalThis.DurableObjectNamespace !== 'undefined') {
        return true;
      }

      // Check for caches API (exists in Workers and browsers, but combined with no window means Workers)
      // @ts-ignore
      if (typeof globalThis.caches !== 'undefined' && typeof globalThis.window === 'undefined') {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a log level should be output based on configured minimum level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level] >= levels[this.logLevel];
  }

  /**
   * Write log entry via HTTP to log service
   */
  private async sendLogToService(level: LogLevel, message: string, data?: unknown): Promise<void> {
    if (!this.fileLogging || !this.logServiceUrl) return;

    try {
      // Don't await - fire and forget to avoid blocking
      fetch(`${this.logServiceUrl}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: this.appName,
          level,
          message,
          data,
        }),
      }).catch(() => {
        // Silently fail if log service is unavailable
        // This prevents logging from breaking the application
      });
    } catch {
      // Silently ignore errors
    }
  }

  /**
   * Write log entry to file (Node.js environment only)
   */
  private async writeToFile(level: LogLevel, message: string, data?: unknown): Promise<void> {
    if (!this.fileLogging) return;

    try {
      const { appendFile } = await import('fs/promises');
      const { join } = await import('path');

      const timestamp = new Date().toISOString();
      const dataStr = data ? ` ${JSON.stringify(data)}` : '';
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;

      // Write to logs directory in monorepo root
      const logFilePath = join(process.cwd(), '../../logs', `${this.appName}.log`);
      await appendFile(logFilePath, logLine, 'utf8');
    } catch (err) {
      // Don't throw if file logging fails
      if (this.consoleLogging) {
        console.error('[LOGGER] Failed to write to log file:', err);
      }
    }
  }

  /**
   * Write log (either via HTTP for Workers or direct file I/O for Node.js)
   */
  private writeLog(level: LogLevel, message: string, data?: unknown): void {
    if (this.useHttpLogging) {
      this.sendLogToService(level, message, data);
    } else {
      this.writeToFile(level, message, data);
    }
  }

  /**
   * Log debug message
   * @param message - Log message
   * @param data - Optional data to include (will be JSON stringified)
   */
  // Console output keeps the format string constant ('%s'): a message that carries user input
  // (ids, URLs) must never be read as a printf-style format (CodeQL js/tainted-format-string).
  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      if (this.consoleLogging) {
        console.log('[DEBUG] %s', message, data ? JSON.stringify(data, null, 2) : '');
      }
      this.writeLog('debug', message, data);
    }
  }

  /**
   * Log info message
   * @param message - Log message
   * @param data - Optional data to include (will be JSON stringified)
   */
  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      if (this.consoleLogging) {
        console.log('[INFO] %s', message, data ? JSON.stringify(data, null, 2) : '');
      }
      this.writeLog('info', message, data);
    }
  }

  /**
   * Log warning message
   * @param message - Log message
   * @param data - Optional data to include (will be JSON stringified)
   */
  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      if (this.consoleLogging) {
        console.warn('[WARN] %s', message, data ? JSON.stringify(data, null, 2) : '');
      }
      this.writeLog('warn', message, data);
    }
  }

  /**
   * Log error message
   * @param message - Log message
   * @param error - Error object or data to include
   */
  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      if (this.consoleLogging) {
        console.error('[ERROR] %s', message, error);
      }
      this.writeLog('error', message, error);
    }
  }

  /**
   * Get current log level
   */
  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  /**
   * Set log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Check if file logging is enabled
   */
  isFileLoggingEnabled(): boolean {
    return this.fileLogging;
  }

  /**
   * Check if using HTTP logging (Workers environment)
   */
  isHttpLoggingEnabled(): boolean {
    return this.useHttpLogging;
  }

  /**
   * Get app name
   */
  getAppName(): string {
    return this.appName;
  }
}

/**
 * Create a logger instance with default configuration
 * @param appName - Application name (used in log file naming)
 * @param config - Optional logger configuration
 */
export function createLogger(appName: string, config: Omit<LoggerConfig, 'appName'> = {}): Logger {
  return new Logger({
    ...config,
    appName,
  });
}

export default Logger;
