/**
 * Scrubbing: no personal data beyond the account id leaves the browser or a
 * Worker, and admin-api scrubs everything again on ingest. Emails, bearer
 * tokens, JWTs, long secrets and sensitive query parameters become
 * placeholders; URLs lose their fragment and keep only harmless parameters.
 */
import { ERROR_APPS, ERROR_KINDS, ERROR_LIMITS, NEEDS_ACTION_SOURCES, type ErrorEventInput, type NeedsActionInput, type NeedsActionRetry } from './types';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** key=value / "key": "value" pairs whose key names a secret */
const SECRET_PAIR = /\b(access_token|refresh_token|id_token|token|code_verifier|client_secret|secret|password|passwd|pwd|api[_-]?key|apikey|auth|authorization|signature|sig|session|cookie)(["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi;
/** OAuth code/state and key in URL-style pairs only ("code: 500" in a message is fine) */
const URL_PAIR = /([?&;\s]|^)(code|state|key)=([^\s"'&,;}]+)/gi;
/** Long opaque strings (hex or base64url) that look like keys or signatures; ids like usr_ are left alone */
const LONG_SECRET = /\b(?![a-z]{2,5}_)[A-Za-z0-9_-]{40,}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** Query parameters kept on reported URLs; everything else is dropped. */
const SAFE_PARAMS = new Set(['v', 't', 'list', 'tab', 'page', 'sort', 'q', 'lang', 'theme', 'kind']);

export function scrubText(input: string | undefined | null, max: number = ERROR_LIMITS.messageMax): string {
  if (!input) return '';
  let s = String(input);
  s = s.replace(JWT, '[token]');
  s = s.replace(BEARER, '$1 [token]');
  s = s.replace(SECRET_PAIR, (_m, key: string, sep: string) => `${key}${sep}[redacted]`);
  s = s.replace(URL_PAIR, (_m, lead: string, key: string) => `${lead}${key}=[redacted]`);
  s = s.replace(EMAIL, '[email]');
  s = s.replace(LONG_SECRET, '[redacted]');
  s = s.replace(IPV4, (ip) => (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('0.') ? '[ip]' : ip));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * A URL or path reduced to path + safe query parameters (no origin, no
 * fragment). Values of kept parameters are scrubbed too.
 */
export function scrubUrl(input: string | undefined | null, max: number = ERROR_LIMITS.routeMax): string {
  if (!input) return '';
  let url: URL;
  try {
    url = new URL(String(input), 'https://x.invalid');
  } catch {
    return scrubText(String(input).split(/[?#]/)[0], max);
  }
  const kept = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (SAFE_PARAMS.has(key)) kept.set(key, scrubText(value, 80));
  });
  const query = kept.toString();
  const path = scrubText(decodeSafe(url.pathname), max);
  const out = query ? `${path}?${query}` : path;
  return out.length > max ? out.slice(0, max) : out;
}

function decodeSafe(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/** Stack traces: scrub every line and strip query strings from frame URLs (they can carry tokens). */
export function scrubStack(stack: string | undefined | null): string {
  if (!stack) return '';
  const lines = String(stack)
    .split('\n')
    .slice(0, 60)
    .map((line) => scrubText(line.replace(/(\.(?:m?js|tsx?|jsx)|\/[^\s)]*)\?[^\s):]*/g, '$1'), 500));
  return lines.join('\n').slice(0, ERROR_LIMITS.stackMax);
}

/** Account ids are the only user identifier reported. */
export const USER_ID = /^usr_[A-Za-z0-9_-]{4,64}$/;
const REF = /^ERR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const SHORT = /^[A-Za-z0-9._:/@+-]{1,80}$/;

const short = (v: unknown): string | undefined => (typeof v === 'string' && SHORT.test(v) ? v : undefined);

/**
 * Validates and scrubs one untrusted event. Returns null when it is not an
 * event at all (unknown app or kind, no message, bad reference).
 */
export function scrubEvent(raw: unknown): ErrorEventInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!ERROR_APPS.includes(e.app as never) || !ERROR_KINDS.includes(e.kind as never)) return null;
  if (typeof e.ref !== 'string' || !REF.test(e.ref)) return null;
  const action = e.kind === 'action' ? scrubAction(e.action) : null;
  if (e.kind === 'action' && !action) return null;
  // A needs-action item may omit the message: its title stands in
  const message = scrubText(typeof e.message === 'string' && e.message ? e.message : action?.title ?? '', ERROR_LIMITS.messageMax);
  if (!message) return null;

  const extra: Record<string, string | number | boolean | null> = {};
  if (e.extra && typeof e.extra === 'object') {
    for (const [k, v] of Object.entries(e.extra as Record<string, unknown>).slice(0, ERROR_LIMITS.extraKeys)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) continue;
      if (typeof v === 'string') extra[k] = scrubText(v, ERROR_LIMITS.extraValueMax);
      else if (typeof v === 'number' && Number.isFinite(v)) extra[k] = v;
      else if (typeof v === 'boolean' || v === null) extra[k] = v;
    }
  }

  const status = typeof e.status === 'number' && Number.isInteger(e.status) && e.status >= 0 && e.status < 1000 ? e.status : undefined;
  const count = typeof e.count === 'number' && Number.isInteger(e.count) && e.count > 0 ? Math.min(e.count, 10_000) : 1;
  const occurredAt = typeof e.occurredAt === 'string' && !Number.isNaN(Date.parse(e.occurredAt)) ? new Date(e.occurredAt).toISOString() : undefined;

  return {
    app: e.app as ErrorEventInput['app'],
    kind: e.kind as ErrorEventInput['kind'],
    ref: e.ref,
    name: typeof e.name === 'string' ? scrubText(e.name, 80) || undefined : undefined,
    message,
    stack: scrubStack(typeof e.stack === 'string' ? e.stack : '') || undefined,
    route: typeof e.route === 'string' ? scrubUrl(e.route) || undefined : undefined,
    method: typeof e.method === 'string' && /^[A-Z]{3,7}$/.test(e.method) ? e.method : undefined,
    status,
    release: short(e.release),
    workerVersion: short(e.workerVersion),
    environment: short(e.environment),
    locale: typeof e.locale === 'string' && /^[a-z]{2}$/.test(e.locale) ? e.locale : undefined,
    theme: typeof e.theme === 'string' && /^[a-z0-9-]{1,40}$/.test(e.theme) ? e.theme : undefined,
    userId: typeof e.userId === 'string' && USER_ID.test(e.userId) ? e.userId : undefined,
    requestId: short(e.requestId),
    occurredAt,
    count,
    shown: e.shown === true,
    test: e.test === true,
    extra: Object.keys(extra).length ? extra : undefined,
    action: action ?? undefined,
  };
}

export const ACTION_KEY = /^[A-Za-z0-9][A-Za-z0-9:._@/-]{0,159}$/;

/** Admin-web path or an https URL on alummahnow.net; anything else is dropped. */
export function cleanItemUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 500) return undefined;
  if (/^\/(?!\/)[^\s]*$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' && (u.hostname === 'alummahnow.net' || u.hostname.endsWith('.alummahnow.net'))) return u.toString();
  } catch {
    // not a URL
  }
  return undefined;
}

function cleanRetry(raw: unknown): NeedsActionRetry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const name = /^[a-z][a-z0-9-]{0,39}$/;
  const args: Record<string, string> = {};
  const rawArgs = (r.kind === 'builtin' ? r.args : r.body) as Record<string, unknown> | undefined;
  if (rawArgs && typeof rawArgs === 'object') {
    for (const [k, v] of Object.entries(rawArgs).slice(0, 10)) {
      if (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v).length <= 200) args[k] = String(v);
    }
  }
  if (r.kind === 'builtin' && typeof r.handler === 'string' && name.test(r.handler)) return { kind: 'builtin', handler: r.handler, args };
  if (r.kind === 'service' && typeof r.service === 'string' && name.test(r.service) && typeof r.path === 'string' && /^\/[A-Za-z0-9/_-]{1,100}$/.test(r.path)) {
    return { kind: 'service', service: r.service, path: r.path, body: args };
  }
  return undefined;
}

/** Validates a needs-action item; null when it is not one. */
export function scrubAction(raw: unknown): NeedsActionInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.key !== 'string' || !ACTION_KEY.test(a.key)) return null;
  if (!NEEDS_ACTION_SOURCES.includes(a.source as never)) return null;
  const title = scrubText(typeof a.title === 'string' ? a.title : '', 160);
  if (!title) return null;
  return {
    key: a.key,
    source: a.source as NeedsActionInput['source'],
    title,
    itemType: typeof a.itemType === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(a.itemType) ? a.itemType : undefined,
    itemId: typeof a.itemId === 'string' && ACTION_KEY.test(a.itemId) ? a.itemId : undefined,
    itemUrl: cleanItemUrl(a.itemUrl),
    retry: cleanRetry(a.retry),
    retryLabel: typeof a.retryLabel === 'string' ? scrubText(a.retryLabel, 40) || undefined : undefined,
  };
}
