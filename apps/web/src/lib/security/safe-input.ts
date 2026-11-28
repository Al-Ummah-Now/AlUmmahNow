/**
 * Shared input validation, URL allowlisting, path-segment encoding, header/log
 * sanitization, and Valibot schemas for apps/web.
 *
 * Pure module (safe in Server Components, Route Handlers, Server Actions, and
 * Client Components). Never weakens existing rendering of valid content.
 */

import * as v from 'valibot';

const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;
const CONTROL_CHARS_GLOBAL_RE = /[\u0000-\u001F\u007F]+/g;
const LOG_UNSAFE_RE = /[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g;
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/]+=*$/i;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_HEADER_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:]+\])(?::\d{1,5})?$/i;
const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;
const PATH_SEGMENT_FORBIDDEN_RE = /[/\\?#\u0000-\u001F\u007F]/;

/**
 * Validate an external http(s) URL for href/src/redirect usage.
 * Rejects javascript:, data:, vbscript:, protocol-relative //, control chars,
 * and malformed URLs.
 */
export function safeHttpUrl(
  value: unknown,
  options: { allowHttp?: boolean } = {},
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || CONTROL_CHARS_RE.test(trimmed)) return null;
  const allowHttp = options.allowHttp ?? true;
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'https:') return trimmed;
    if (allowHttp && protocol === 'http:') return trimmed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate a same-origin relative path (must start with single `/`, never `//`,
 * no backslashes or control characters, and must stay on the base origin).
 */
export function safeSameOriginPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed.includes('\\') || CONTROL_CHARS_RE.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed, 'https://origin.invalid');
    if (parsed.origin !== 'https://origin.invalid') return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Validate an image `src` attribute value.
 * Allows https:/http:, optionally safe same-origin `/...` paths, and optionally
 * raster `data:image/(png|jpeg|webp|gif|avif);base64,...` URIs (never SVG/HTML).
 */
export function safeImageUrl(
  value: unknown,
  options: { allowRelative?: boolean; allowHttp?: boolean; allowDataImage?: boolean } = {},
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || CONTROL_CHARS_RE.test(trimmed)) return null;

  const allowRelative = options.allowRelative ?? true;
  const allowHttp = options.allowHttp ?? true;
  const allowDataImage = options.allowDataImage ?? false;

  if (allowDataImage && SAFE_DATA_IMAGE_RE.test(trimmed)) {
    return trimmed;
  }
  if (allowRelative && trimmed.startsWith('/')) {
    return safeSameOriginPath(trimmed);
  }
  return safeHttpUrl(trimmed, { allowHttp });
}

/**
 * Validate an email address and return a safe `mailto:` href, or null.
 */
export function safeMailtoHref(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254 || CONTROL_CHARS_RE.test(trimmed)) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return `mailto:${trimmed}`;
}

/**
 * Validate a URL before passing it to `window.location.assign(...)` or an `<a>`
 * link that may target either an external https(s) URL or a same-origin path.
 */
export function safeNavigationUrl(
  value: unknown,
  options: { allowRelative?: boolean; allowHttp?: boolean } = {},
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || CONTROL_CHARS_RE.test(trimmed)) return null;
  if (options.allowRelative && trimmed.startsWith('/')) {
    return safeSameOriginPath(trimmed);
  }
  return safeHttpUrl(trimmed, { allowHttp: options.allowHttp ?? false });
}

/**
 * Strict DNS hostname validator (no `..`, no leading/trailing `.` or `-`, no
 * port, path, whitespace, or control chars). Returns normalized lowercase host.
 */
export function safeHostname(value: unknown, options: { requireDot?: boolean } = {}): string | null {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase();
  if (!host || host.length > 253 || CONTROL_CHARS_RE.test(host)) return null;
  const labels = host.split('.');
  if (options.requireDot && labels.length < 2) return null;
  if (labels.some((label) => !DNS_LABEL_RE.test(label))) return null;
  return host;
}

/**
 * Validate an HTTP `Host` header value (hostname or IPv4/bracketed IPv6 +
 * optional `:port`). Rejects spaces, slashes, `@`, `?`, `#`, control chars.
 */
export function safeHostHeader(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 259 || CONTROL_CHARS_RE.test(trimmed)) return null;
  if (!HOST_HEADER_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Exact localhost / loopback host header check (never `.includes('localhost')`).
 */
export function isLocalHostHeader(host: string | null | undefined): boolean {
  return typeof host === 'string' && LOCAL_HOST_RE.test(host.trim());
}

/**
 * Validate a single URL path segment (ID, handle, language tag, etc.).
 * Rejects empty, `.`, `..`, slashes, query/fragment chars, and control chars.
 */
export function safePathSegment(value: unknown, maxLength = 256): string | null {
  if (typeof value !== 'string') return null;
  if (!value || value.length > maxLength) return null;
  if (value === '.' || value === '..') return null;
  if (PATH_SEGMENT_FORBIDDEN_RE.test(value)) return null;
  return value;
}

/**
 * Validate and percent-encode a single path segment for upstream URLs.
 * Returns null if the segment is empty, dot-traversal, or contains delimiters.
 */
export function encodePathSegment(value: unknown, maxLength = 256): string | null {
  const safe = safePathSegment(value, maxLength);
  return safe === null ? null : encodeURIComponent(safe);
}

/**
 * Encode a single API path segment or throw if it contains traversal/delimiters.
 */
export function apiSegment(value: string): string {
  const encoded = encodePathSegment(value);
  if (!encoded) throw new Error('Invalid API path segment');
  return encoded;
}

/**
 * Strip CR, LF, NUL, and other ASCII control characters from a forwarded HTTP
 * header value and bound its length.
 */
export function sanitizeHeaderValue(value: unknown, maxLength = 512): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHARS_GLOBAL_RE, '').trim().slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Collapse newlines, CR/LF, and control characters into single spaces before
 * writing untrusted values into logs (prevents log forging / injection).
 */
export function sanitizeLogText(value: unknown, maxLength = 500): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(LOG_UNSAFE_RE, ' ').trim().slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Valibot schemas for Route Handlers and Server Actions
// ---------------------------------------------------------------------------

/** Plain JSON object (rejects arrays, null, primitives). */
export const jsonObjectSchema = v.custom<Record<string, unknown>>(
  (val) => typeof val === 'object' && val !== null && !Array.isArray(val),
  'expected_object',
);

/** POST /api/errors browser report envelope. */
export const errorReportEnvelopeSchema = v.object({
  events: v.pipe(
    v.array(v.record(v.string(), v.unknown())),
    v.maxLength(100),
  ),
});

/** POST /api/studio/site-domains/:channelId and PUT .../primary body. */
export const siteDomainHostBodySchema = v.object({
  host: v.pipe(
    v.string(),
    v.trim(),
    v.check((s) => safeHostname(s, { requireDot: true }) !== null, 'invalid_host'),
  ),
});

const qoeLiveDeltaSchema = v.object({
  attempt: v.optional(v.boolean()),
  started: v.optional(v.boolean()),
  startupMs: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(3_600_000))),
  watchMs: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(86_400_000)),
  rebufferMs: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(86_400_000)),
  rebuffers: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(10_000)),
  avgKbps: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1_000_000))),
  errored: v.optional(v.boolean()),
  fallback: v.optional(v.boolean()),
});

/** POST /api/analytics/qoe body (strips unknown/forged keys such as country). */
export const qoeBeaconSchema = v.object({
  videoId: v.pipe(v.string(), v.regex(/^[A-Za-z0-9-]{8,64}$/)),
  sessionId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(128))),
  source: v.optional(v.pipe(v.string(), v.maxLength(32))),
  device: v.optional(v.pipe(v.string(), v.maxLength(32))),
  started: v.optional(v.boolean()),
  startupMs: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(3_600_000))),
  rebuffers: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(10_000))),
  rebufferMs: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(86_400_000))),
  watchMs: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(86_400_000))),
  avgKbps: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1_000_000))),
  peakKbps: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1_000_000))),
  switches: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(10_000))),
  errors: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(10_000))),
  fallback: v.optional(v.boolean()),
  requested: v.optional(v.pipe(v.string(), v.maxLength(32))),
  actual: v.optional(v.pipe(v.string(), v.maxLength(32))),
  fallbackReason: v.optional(v.pipe(v.string(), v.maxLength(64))),
  kind: v.optional(v.picklist(['final', 'heartbeat'])),
  serving: v.optional(v.pipe(v.string(), v.maxLength(32))),
  playing: v.optional(v.boolean()),
  live: v.optional(qoeLiveDeltaSchema),
});

/** POST /api/analytics/video body. */
export const videoAnalyticsBatchSchema = v.object({
  events: v.optional(
    v.pipe(
      v.array(
        v.object({
          eventType: v.pipe(v.string(), v.maxLength(64)),
          videoId: v.optional(v.unknown()),
          sessionId: v.optional(v.unknown()),
          data: v.optional(v.unknown()),
          timestamp: v.optional(v.unknown()),
        }),
      ),
      v.maxLength(200),
    ),
    [],
  ),
  context: v.optional(v.record(v.string(), v.unknown())),
});

/** Moderation report submission input (lib/api/moderation.ts). */
export const createModerationReportSchema = v.object({
  contentType: v.picklist(['video', 'comment', 'channel', 'livestream', 'live_chat', 'post']),
  contentId: v.pipe(v.string(), v.check((s) => safePathSegment(s, 128) !== null)),
  reason: v.picklist(['child_safety', 'inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other']),
  customReason: v.optional(v.pipe(v.string(), v.maxLength(500))),
  description: v.optional(v.pipe(v.string(), v.maxLength(4000))),
});

/** AI text translation server action input (lib/api/translate.ts). */
export const translateTextsSchema = v.object({
  items: v.pipe(
    v.array(
      v.object({
        id: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
        text: v.pipe(v.string(), v.maxLength(10_000)),
      }),
    ),
    v.minLength(1),
    v.maxLength(50),
  ),
  from: v.pipe(v.string(), v.regex(/^[a-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$/)),
  to: v.pipe(v.string(), v.regex(/^[a-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$/)),
  field: v.optional(v.pipe(v.string(), v.maxLength(32))),
  videoId: v.optional(v.pipe(v.string(), v.check((s) => safePathSegment(s, 128) !== null))),
});
