/**
 * Logging policy shared by every app (Workers, Next server, browser).
 * Pure functions only: no Node or Workers APIs, so browser bundles can import it
 * (`@al-ummah/logger/policy`).
 *
 * Levels by environment (docs/operations/logging.md):
 *   production → warn   (LOG_LEVEL may raise it to info for an incident, never debug/trace)
 *   stage      → info
 *   qa / dev   → debug
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOG_LEVELS, value);
}

/** Default level for each deployed environment name (ENVIRONMENT / NEXTJS_ENV). */
export const ENVIRONMENT_LOG_LEVELS: Record<string, LogLevel> = {
  production: 'warn',
  stage: 'info',
  staging: 'info',
  qa: 'debug',
  preview: 'debug',
  development: 'debug',
  dev: 'debug',
  local: 'debug',
  test: 'debug',
};

/** The lowest level production may ever emit. */
export const PRODUCTION_FLOOR: LogLevel = 'info';

export interface LogLevelInputs {
  /** LOG_LEVEL var. */
  logLevel?: unknown;
  /** ENVIRONMENT / NEXTJS_ENV var. */
  environment?: unknown;
  /** NODE_ENV, consulted only when the environment is unknown. */
  nodeEnv?: unknown;
}

function normalise(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

export function isProductionEnvironment(environment: unknown): boolean {
  return normalise(environment) === 'production';
}

/**
 * The minimum level to emit. An explicit LOG_LEVEL wins, except that production
 * never goes below info (debug/trace are never emitted there). With no LOG_LEVEL
 * the environment decides; an unknown environment gets warn (the safe default for
 * a deployed Worker) unless NODE_ENV says development/test.
 */
export function resolveLogLevel(inputs: LogLevelInputs = {}): LogLevel {
  const environment = normalise(inputs.environment);
  const explicit = normalise(inputs.logLevel);
  let level: LogLevel;
  if (isLogLevel(explicit)) {
    level = explicit;
  } else if (environment && ENVIRONMENT_LOG_LEVELS[environment]) {
    level = ENVIRONMENT_LOG_LEVELS[environment];
  } else {
    const nodeEnv = normalise(inputs.nodeEnv);
    level = nodeEnv === 'development' || nodeEnv === 'test' ? 'debug' : 'warn';
  }
  if (environment === 'production' && LOG_LEVELS[level] < LOG_LEVELS[PRODUCTION_FLOOR]) {
    level = PRODUCTION_FLOOR;
  }
  return level;
}

export function levelEnabled(level: LogLevel, minimum: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minimum];
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Keys whose values are never logged. Matched case-insensitively against the whole key. */
const SECRET_KEY =
  /^(?:.*(?:password|passwd|secret|token|authorization|cookie|api[-_]?key|apikey|private[-_]?key|signature|credential|jwt|otp|bearer|session[-_]?id|sessionid)s?|code[-_]?verifier|set-cookie|x-api-key)$/i;
/** Keys that hold an email address. */
const EMAIL_KEY = /^(?:.*email(?:address)?|e-mail|mail)$/i;
/** Keys that hold a whole request/response body. */
const BODY_KEY = /^(?:request[-_]?body|req[-_]?body|raw[-_]?body|body[-_]?text|payload|form[-_]?data)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_PARAM_RE =
  /([?&](?:token|access_token|refresh_token|id_token|code|code_verifier|key|api_key|signature|sig|secret|password)=)[^&#\s"']+/gi;

export const REDACTED = '[redacted]';
export const REDACTED_EMAIL = '[email]';

const MAX_STRING = 2000;
const MAX_ARRAY = 50;
const MAX_KEYS = 50;
const MAX_DEPTH = 6;

/** Removes emails, JWTs, bearer credentials and secret URL parameters from free text. */
export function redactString(value: string): string {
  // Bound the input first: the patterns below scan it, and log lines are capped anyway.
  let out = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING} chars]` : value;
  if (out.includes('eyJ')) out = out.replace(JWT_RE, REDACTED);
  if (/bearer|basic/i.test(out)) out = out.replace(BEARER_RE, `$1 ${REDACTED}`);
  if (out.includes('=')) out = out.replace(SECRET_PARAM_RE, `$1${REDACTED}`);
  if (out.includes('@')) out = out.replace(EMAIL_RE, REDACTED_EMAIL);
  return out;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: unknown;
  status?: unknown;
  cause?: unknown;
}

/**
 * Copy of `value` that is safe to log: secrets, tokens, emails and bodies are
 * replaced, Errors become { name, message, stack } (JSON.stringify drops them to
 * {}), and size is bounded (depth, keys, array items, string length).
 */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value !== 'object') return String(value);

  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  seen.add(value);

  if (value instanceof Error) {
    const err = value as Error & { code?: unknown; status?: unknown; cause?: unknown };
    const out: SerializedError = { name: err.name, message: redactString(err.message ?? '') };
    if (err.stack) out.stack = redactString(err.stack);
    if (err.code !== undefined) out.code = redact(err.code, depth + 1, seen);
    if (err.status !== undefined) out.status = redact(err.status, depth + 1, seen);
    if (err.cause !== undefined) out.cause = redact(err.cause, depth + 1, seen);
    return out;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (typeof URL !== 'undefined' && value instanceof URL) return redactString(value.toString());
  if (typeof Headers !== 'undefined' && value instanceof Headers) return REDACTED;
  if (typeof Request !== 'undefined' && value instanceof Request) {
    return { method: value.method, url: redactString(value.url) };
  }
  if (typeof Response !== 'undefined' && value instanceof Response) {
    return { status: value.status, statusText: value.statusText };
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1, seen));
    if (value.length > MAX_ARRAY) items.push(`…[+${value.length - MAX_ARRAY} items]`);
    return items;
  }

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, v] of entries.slice(0, MAX_KEYS)) {
    if (v === undefined) continue;
    // Booleans (hasToken, emailVerified) and null carry no secret.
    if (typeof v === 'boolean' || v === null) {
      out[key] = v;
      continue;
    }
    if (SECRET_KEY.test(key)) out[key] = v === '' ? v : REDACTED;
    else if (EMAIL_KEY.test(key)) out[key] = v === '' ? v : REDACTED_EMAIL;
    else if (BODY_KEY.test(key)) out[key] = v === '' ? v : '[body omitted]';
    else out[key] = redact(v, depth + 1, seen);
  }
  if (entries.length > MAX_KEYS) out['…'] = `+${entries.length - MAX_KEYS} keys`;
  return out;
}

// ---------------------------------------------------------------------------
// Per-request / per-job summaries
// ---------------------------------------------------------------------------

/** A request or job slower than this logs a warning even in production. */
export const SLOW_MS = 1500;

export interface SummaryOutcome {
  /** HTTP status, when there is one. */
  status?: number;
  durationMs: number;
  /** Set when the request/job failed with an exception. */
  error?: unknown;
  /** Job outcome ('ok' | 'retry' | 'failed' | …); 'failed' counts as an error. */
  outcome?: string;
}

/**
 * Level of the one summary line a request or job emits: error for 5xx, a thrown
 * error or a failed job; warn when slow; otherwise info (so production, at warn,
 * drops healthy requests and stage keeps them).
 */
export function summaryLevel(s: SummaryOutcome, slowMs: number = SLOW_MS): LogLevel {
  if (s.error !== undefined && s.error !== null) return 'error';
  if (typeof s.status === 'number' && s.status >= 500) return 'error';
  if (s.outcome === 'failed') return 'error';
  if (s.durationMs >= slowMs) return 'warn';
  if (s.outcome === 'retry') return 'warn';
  return 'info';
}
