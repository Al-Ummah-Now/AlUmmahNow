/**
 * InputSanitizer (Story 1.2, AC 5)
 *
 * Sanitizes untrusted data before it is processed as an event: analytics and
 * performance beacons, WebSocket messages, and any user-provided strings that
 * end up in event payloads. Dependency-free so it can run in the browser, in
 * Next.js route handlers and in unit tests.
 *
 * The sanitizer is intentionally conservative:
 * - strings: control characters removed, HTML tags stripped, dangerous URL
 *   schemes neutralised, length capped
 * - objects: prototype-pollution keys dropped, depth / key / array limits
 * - anything that is not JSON-like (functions, symbols, class instances) dropped
 */

export interface SanitizeOptions {
  maxDepth?: number;
  maxStringLength?: number;
  maxKeys?: number;
  maxArrayLength?: number;
  /**
   * Strip markup from strings (default true). Disable for payloads whose text
   * is only ever rendered through React (which escapes it), so legitimate
   * text such as "2 < 3" survives; control characters are still removed.
   */
  stripMarkup?: boolean;
}

export interface SanitizeResult<T> {
  value: T;
  /** True when anything was removed or rewritten. */
  modified: boolean;
}

const DEFAULTS: Required<SanitizeOptions> = {
  maxDepth: 6,
  maxStringLength: 2048,
  maxKeys: 100,
  maxArrayLength: 200,
  stripMarkup: true,
};

function stripControlChars(input: string, maxLength: number): string {
  const out = String(input).replace(CONTROL_CHARS, '');
  return out.length > maxLength ? out.slice(0, maxLength) : out;
}

/** Keys that can pollute Object.prototype when merged. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const SCRIPT_OR_STYLE_BLOCK = /<(script|style|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_TAG = /<\/?[a-z!][^>]*>/gi;
const DANGEROUS_SCHEME = /\b(?:java|vb|live)script\s*:|\bdata\s*:\s*text\/html/gi;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
};

/** Escape a string for safe interpolation into HTML. */
export function escapeHtml(input: string): string {
  return String(input).replace(/[&<>"'/`]/g, ch => HTML_ESCAPES[ch]);
}

/**
 * Sanitize a single string for use as event data / plain text.
 * Arabic and other non-Latin text is preserved; only markup and control
 * characters are removed.
 */
export function sanitizeText(input: string, maxLength = DEFAULTS.maxStringLength): string {
  let out = String(input).normalize('NFC');
  out = out.replace(CONTROL_CHARS, '');
  // Strip whole script-like blocks first so their bodies do not survive as text.
  let previous: string;
  do {
    previous = out;
    out = out.replace(SCRIPT_OR_STYLE_BLOCK, '').replace(HTML_TAG, '');
  } while (out !== previous);
  out = out.replace(DANGEROUS_SCHEME, '');
  // Any remaining angle brackets cannot form tags any more; encode them anyway.
  out = out.replace(/[<>]/g, ch => (ch === '<' ? '&lt;' : '&gt;'));
  return out.length > maxLength ? out.slice(0, maxLength) : out;
}

/** Only http(s) and same-origin relative URLs survive; everything else becomes ''. */
export function sanitizeUrl(input: string): string {
  const trimmed = String(input).replace(CONTROL_CHARS, '').trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-sanitize an untrusted event payload. Returns a new value; the input is
 * never mutated.
 */
export function sanitizeEventPayload<T = unknown>(input: unknown, options: SanitizeOptions = {}): SanitizeResult<T> {
  const opts = { ...DEFAULTS, ...options };
  let modified = false;

  const walk = (value: unknown, depth: number): unknown => {
    if (value === null) return null;
    switch (typeof value) {
      case 'string': {
        const clean = opts.stripMarkup
          ? sanitizeText(value, opts.maxStringLength)
          : stripControlChars(value, opts.maxStringLength);
        if (clean !== value) modified = true;
        return clean;
      }
      case 'number':
        if (!Number.isFinite(value)) {
          modified = true;
          return null;
        }
        return value;
      case 'boolean':
        return value;
      case 'object':
        break;
      default:
        // functions, symbols, bigint, undefined
        modified = true;
        return undefined;
    }

    if (depth >= opts.maxDepth) {
      modified = true;
      return undefined;
    }

    if (Array.isArray(value)) {
      if (value.length > opts.maxArrayLength) modified = true;
      return value
        .slice(0, opts.maxArrayLength)
        .map(item => walk(item, depth + 1))
        .filter(item => item !== undefined);
    }

    if (!isPlainObject(value)) {
      modified = true;
      return undefined;
    }

    const out: Record<string, unknown> = {};
    const keys = Object.keys(value);
    if (keys.length > opts.maxKeys) modified = true;
    for (const key of keys.slice(0, opts.maxKeys)) {
      if (FORBIDDEN_KEYS.has(key)) {
        modified = true;
        continue;
      }
      const cleanKey = sanitizeText(key, 128);
      if (cleanKey !== key) modified = true;
      if (!cleanKey) continue;
      const cleanValue = walk(value[key], depth + 1);
      if (cleanValue !== undefined) out[cleanKey] = cleanValue;
    }
    return out;
  };

  const value = walk(input, 0);
  return { value: value as T, modified };
}

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface StructureSchema {
  required?: Record<string, FieldType>;
  optional?: Record<string, FieldType>;
  /** Reject keys not declared in required/optional. Defaults to false. */
  strict?: boolean;
}

function typeOf(value: unknown): FieldType | 'other' {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'other';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  if (t === 'object') return 'object';
  return 'other';
}

/** Validate the shape of an (already sanitized) event payload. */
export function validateStructure(data: unknown, schema: StructureSchema): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(data)) return { valid: false, errors: ['payload-not-object'] };
  for (const [key, type] of Object.entries(schema.required ?? {})) {
    if (!(key in data)) errors.push(`missing:${key}`);
    else if (typeOf(data[key]) !== type) errors.push(`type:${key}`);
  }
  for (const [key, type] of Object.entries(schema.optional ?? {})) {
    if (key in data && data[key] !== undefined && typeOf(data[key]) !== type) errors.push(`type:${key}`);
  }
  if (schema.strict) {
    const known = new Set([...Object.keys(schema.required ?? {}), ...Object.keys(schema.optional ?? {})]);
    for (const key of Object.keys(data)) if (!known.has(key)) errors.push(`unexpected:${key}`);
  }
  return { valid: errors.length === 0, errors };
}

export const InputSanitizer = {
  sanitize: sanitizeText,
  sanitizeUrl,
  sanitizeEventPayload,
  validateStructure,
  escapeHtml,
};
