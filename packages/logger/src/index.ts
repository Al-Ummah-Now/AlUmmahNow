/* eslint-disable no-console -- this module is the one place that writes to the console */
import {
  levelEnabled,
  redact,
  redactString,
  resolveLogLevel,
  summaryLevel,
  SLOW_MS,
  type LogLevel,
} from './policy.js';

export * from './policy.js';

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /**
   * Minimum log level to output. Leave unset in app code: the level then comes
   * from the environment (configureLogging(env), or LOG_LEVEL / ENVIRONMENT /
   * NEXTJS_ENV in process.env) per the logging policy in ./policy.ts.
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

// ---------------------------------------------------------------------------
// Process-wide level (one per isolate)
// ---------------------------------------------------------------------------

/** Worker bindings / process.env subset that decides the level. */
export interface LoggingEnv {
  LOG_LEVEL?: unknown;
  ENVIRONMENT?: unknown;
  NEXTJS_ENV?: unknown;
}

let globalLevel: LogLevel | null = null;

/**
 * Sets the level for every logger without an explicit one. Workers call it at the
 * top of each fetch/scheduled/queue handler with their `env` (bindings are not in
 * process.env at older compatibility dates); it is cheap and idempotent.
 */
export function configureLogging(env: LoggingEnv | undefined | null): LogLevel {
  globalLevel = resolveLogLevel({
    logLevel: env?.LOG_LEVEL,
    environment: env?.ENVIRONMENT ?? env?.NEXTJS_ENV,
    nodeEnv: readEnv('NODE_ENV'),
  });
  return globalLevel;
}

/** Current process-wide level; resolved from process.env the first time. */
export function getGlobalLogLevel(): LogLevel {
  if (globalLevel === null) {
    globalLevel = resolveLogLevel({
      logLevel: readEnv('LOG_LEVEL'),
      environment: readEnv('ENVIRONMENT') ?? readEnv('NEXTJS_ENV'),
      nodeEnv: readEnv('NODE_ENV'),
    });
  }
  return globalLevel;
}

/** Test helper: forget the configured level so the next call re-reads the environment. */
export function resetLogging(): void {
  globalLevel = null;
  sink = null;
}

// ---------------------------------------------------------------------------
// Sink for warn/error (admin Errors pipeline)
// ---------------------------------------------------------------------------

/** One structured log entry, already redacted. */
export interface LogEntry {
  level: LogLevel;
  app: string;
  msg: string;
  [field: string]: unknown;
}

export type LogSink = (entry: LogEntry, original: unknown) => void;
let sink: LogSink | null = null;

/**
 * Registers a callback for every emitted warn/error entry (after level gating
 * and redaction), e.g. the admin Errors reporter. `original` is the unredacted
 * data argument so a reporter can keep the real Error for its stack.
 * The sink must not throw; if it does, the error is swallowed.
 */
export function setLogSink(next: LogSink | null): void {
  sink = next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Builds the single structured entry for one log call. */
export function buildEntry(level: LogLevel, app: string, message: string, data?: unknown): LogEntry {
  const entry: LogEntry = { level, app, msg: redactString(String(message)) };
  if (data === undefined) return entry;
  const safe = redact(data);
  if (data instanceof Error) entry.error = safe;
  else if (isPlainObject(safe)) {
    for (const [k, v] of Object.entries(safe)) {
      if (k === 'level' || k === 'app' || k === 'msg') entry[`data_${k}`] = v;
      else entry[k] = v;
    }
  } else entry.data = safe;
  return entry;
}

/** Per-request summary fields (route, status, duration, ids). */
export interface RequestSummary {
  method?: string;
  /** Route pattern or pathname (never the query string). */
  route: string;
  status?: number;
  durationMs: number;
  error?: unknown;
  [id: string]: unknown;
}

/** Per-job (queue message, cron tick, admin job) summary. */
export interface JobSummary {
  job: string;
  /** 'ok' | 'retry' | 'failed' | 'skipped' … */
  outcome: string;
  durationMs: number;
  error?: unknown;
  [id: string]: unknown;
}

/**
 * Logger class for Al Ummah Now applications
 *
 * Every call writes at most one structured console entry ({ level, app, msg, …fields })
 * which Workers Logs indexes field by field. Data is redacted (secrets, tokens,
 * emails, bodies) and Errors keep their name/message/stack.
 *
 * @example
 * ```typescript
 * const logger = createLogger('api-videos');
 * logger.warn('Bunny webhook rejected', { videoId, status });
 * logger.request({ method: 'GET', route: '/videos/:id', status: 200, durationMs: 42 });
 * ```
 */
export class Logger {
  private logLevel: LogLevel | null;
  private appName: string;
  private consoleLogging: boolean;
  private fileLogging: boolean;
  private logServiceUrl: string | null;
  private useHttpLogging: boolean = false;

  constructor(config: LoggerConfig = {}) {
    this.logLevel = config.logLevel ?? null;
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
      // @ts-ignore - These globals exist in Workers but not in Node.js
      if (typeof globalThis.WebSocketPair !== 'undefined') {
        return true;
      }
      // @ts-ignore
      if (typeof globalThis.DurableObjectNamespace !== 'undefined') {
        return true;
      }
      // @ts-ignore
      if (typeof globalThis.caches !== 'undefined' && typeof globalThis.window === 'undefined') {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Whether a call at `level` would be emitted. Use it to skip building costly data. */
  isEnabled(level: LogLevel): boolean {
    return levelEnabled(level, this.getLogLevel());
  }

  /**
   * Write log entry via HTTP to log service (local development only)
   */
  private sendLogToService(entry: LogEntry): void {
    if (!this.fileLogging || !this.logServiceUrl) return;
    try {
      fetch(`${this.logServiceUrl}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: this.appName, level: entry.level, message: entry.msg, data: entry }),
      }).catch(() => {
        // Silently fail if log service is unavailable
      });
    } catch {
      // Silently ignore errors
    }
  }

  /**
   * Write log entry to file (Node.js local development only)
   */
  private async writeToFile(entry: LogEntry): Promise<void> {
    if (!this.fileLogging) return;
    try {
      const { appendFile } = await import('fs/promises');
      const { join } = await import('path');
      const logLine = `[${new Date().toISOString()}] [${entry.level.toUpperCase()}] ${entry.msg} ${JSON.stringify(entry)}\n`;
      const logFilePath = join(process.cwd(), '../../logs', `${this.appName}.log`);
      await appendFile(logFilePath, logLine, 'utf8');
    } catch {
      // File logging is best effort (no logs/ dir in deployed runtimes)
    }
  }

  private emit(level: LogLevel, message: string, data?: unknown): void {
    if (!this.isEnabled(level)) return;
    const entry = buildEntry(level, this.appName, message, data);
    if (this.consoleLogging) {
      // One object per call: Workers Logs indexes its fields, and a constant-shape
      // object can never be read as a printf format (CodeQL js/tainted-format-string).
      if (level === 'error') console.error(entry);
      else if (level === 'warn') console.warn(entry);
      else if (level === 'info') console.info(entry);
      else console.debug(entry);
    }
    if (this.useHttpLogging) this.sendLogToService(entry);
    else if (this.logServiceUrl || readEnv('NODE_ENV') === 'development') void this.writeToFile(entry);
    if (sink && (level === 'warn' || level === 'error')) {
      try {
        sink(entry, data);
      } catch {
        // A reporter failure must never break the caller
      }
    }
  }

  /** Very fine-grained tracing; QA/dev only, never emitted in production. */
  trace(message: string, data?: unknown): void {
    this.emit('trace', message, data);
  }

  /** Diagnostic detail; QA/dev only, never emitted in production. */
  debug(message: string, data?: unknown): void {
    this.emit('debug', message, data);
  }

  /** Stage and below. Prefer one request()/job() summary over several info lines. */
  info(message: string, data?: unknown): void {
    this.emit('info', message, data);
  }

  /** Something went wrong but was handled. Keep full context (ids, step, status). */
  warn(message: string, data?: unknown): void {
    this.emit('warn', message, data);
  }

  /** A failure. Pass the Error (or { error, …ids }) so the stack is kept. */
  error(message: string, error?: unknown): void {
    this.emit('error', message, error);
  }

  /**
   * The one summary line for a request: info normally (stage and below), warn
   * when slower than `slowMs`, error on 5xx or a thrown error.
   */
  request(summary: RequestSummary, slowMs: number = SLOW_MS): void {
    const level = summaryLevel(summary, slowMs);
    const { method, route, status } = summary;
    const label = level === 'warn' ? 'slow request' : level === 'error' ? 'request failed' : 'request';
    this.emit(level, `${label} ${method ?? ''} ${route} ${status ?? ''}`.replace(/\s+/g, ' ').trim(), summary);
  }

  /** The one summary line for a job (queue message, cron tick, admin job). */
  job(summary: JobSummary, slowMs: number = SLOW_MS): void {
    const level = summaryLevel(summary, slowMs);
    this.emit(level, `job ${summary.job} ${summary.outcome}${level === 'warn' && summary.durationMs >= slowMs ? ' (slow)' : ''}`, summary);
  }

  /** Effective level: explicit config, else the process-wide policy level. */
  getLogLevel(): LogLevel {
    return this.logLevel ?? getGlobalLogLevel();
  }

  /** Pins this logger's level (null returns it to the process-wide level). */
  setLogLevel(level: LogLevel | null): void {
    this.logLevel = level;
  }

  isFileLoggingEnabled(): boolean {
    return this.fileLogging;
  }

  isHttpLoggingEnabled(): boolean {
    return this.useHttpLogging;
  }

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

/** The logger shape apps export: bound methods, safe to destructure or mock. */
export interface AppLogger {
  trace(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, error?: unknown): void;
  request(summary: RequestSummary, slowMs?: number): void;
  job(summary: JobSummary, slowMs?: number): void;
  isEnabled(level: LogLevel): boolean;
}

/** An app's logger, levelled by the logging policy (no per-app level). */
export function appLogger(appName: string, config: Omit<LoggerConfig, 'appName' | 'logLevel'> = {}): AppLogger {
  const base = createLogger(appName, { forceHttpLogging: true, ...config });
  return {
    trace: (m, d) => base.trace(m, d),
    debug: (m, d) => base.debug(m, d),
    info: (m, d) => base.info(m, d),
    warn: (m, d) => base.warn(m, d),
    error: (m, e) => base.error(m, e),
    request: (s, slow) => base.request(s, slow),
    job: (s, slow) => base.job(s, slow),
    isEnabled: (l) => base.isEnabled(l),
  };
}

/**
 * Wraps a Worker's exported handlers (fetch / scheduled / queue / email) so each
 * invocation first applies the logging policy from its `env` (the second
 * argument of every handler). Needed where bindings are not in process.env.
 */
export function withLogging<T extends object>(handlers: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(handlers)) {
    if (typeof value === 'function') {
      out[name] = (first: unknown, env: LoggingEnv | undefined, ...rest: unknown[]) => {
        configureLogging(env);
        return (value as (...args: unknown[]) => unknown).call(handlers, first, env, ...rest);
      };
    } else {
      out[name] = value;
    }
  }
  return out as T;
}

export default Logger;
