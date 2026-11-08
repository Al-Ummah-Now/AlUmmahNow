/**
 * Name and options of the session cookie (all signed-in accounts' tokens).
 *
 * Kept free of `next/headers` so the middleware (which writes the cookie when
 * it refreshes tokens) and SessionManager share exactly the same settings.
 */

export const SESSION_COOKIE_NAME = 'al_ummah_session';

/** 30 days in seconds. The refresh token inside lives longer; see token-refresh.ts. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  };
}

/** Browsers drop a cookie whose `name=value` (value URL-encoded) is longer than this. */
export const BROWSER_COOKIE_LIMIT = 4096;

/**
 * Most encoded value bytes per chunk. Leaves room under BROWSER_COOKIE_LIMIT
 * for the name (`al_ummah_session.9=`) with margin.
 */
const CHUNK_VALUE_LIMIT = 3900;

/**
 * Chunks read back at most. 10 accounts (SessionManager's limit) take about 4;
 * the cap only bounds the loop over a hostile or stale cookie jar.
 */
const MAX_CHUNKS = 16;

/**
 * The session can be bigger than one cookie: each account holds a ~700
 * character access token and its channels, and the value is URL-encoded on
 * the wire (~1.3x for JSON), so two accounts came to ~4.4 KB and browsers
 * silently dropped the whole cookie. The value is therefore split across
 * `al_ummah_session`, `al_ummah_session.1`, `al_ummah_session.2`, ...
 * A session that fits stays in the one `al_ummah_session` cookie it always
 * used, so existing cookies and readers of a single account keep working.
 */
export function sessionChunkName(index: number): string {
  return index === 0 ? SESSION_COOKIE_NAME : `${SESSION_COOKIE_NAME}.${index}`;
}

/** True for the session cookie and its chunks. */
export function isSessionCookieName(name: string): boolean {
  return name === SESSION_COOKIE_NAME || new RegExp(`^${SESSION_COOKIE_NAME}\\.[1-9]\\d*$`).test(name);
}

/** Splits a session value into chunk values whose URL-encoded size fits a cookie. */
export function splitSessionValue(value: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentSize = 0;
  // By code point, so a surrogate pair (emoji in a display name) is never split
  for (const char of value) {
    const size = encodeURIComponent(char).length;
    if (currentSize + size > CHUNK_VALUE_LIMIT) {
      chunks.push(current);
      current = '';
      currentSize = 0;
    }
    current += char;
    currentSize += size;
  }
  chunks.push(current);
  return chunks;
}

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** The whole session value: `al_ummah_session` followed by its chunks, in order. */
export function readSessionValue(cookies: CookieReader): string | undefined {
  const first = cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!first) return undefined;
  let value = first;
  for (let i = 1; i < MAX_CHUNKS; i++) {
    const chunk = cookies.get(sessionChunkName(i))?.value;
    if (!chunk) break;
    value += chunk;
  }
  return value;
}

/** Names of the session cookies present now (to delete the ones a write no longer uses). */
export function presentSessionCookieNames(cookies: CookieReader): string[] {
  const names: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    if (cookies.get(sessionChunkName(i)) !== undefined) names.push(sessionChunkName(i));
  }
  return names;
}

type SessionCookieOptions = ReturnType<typeof sessionCookieOptions>;

/** A response's (or Server Action's) cookie store: cookies with attributes. */
interface CookieWriter {
  set(name: string, value: string, options: SessionCookieOptions): unknown;
  delete(name: string): unknown;
}

/** A request's cookie store (the middleware's forwarded request): bare cookies. */
interface BareCookieWriter {
  set(name: string, value: string): unknown;
  delete(name: string): unknown;
}

/**
 * Writes `value` as the session cookie and its chunks, and deletes chunks in
 * `present` that the new value no longer needs (a stale `.1` would otherwise
 * be appended to a shorter session and corrupt it). `options` false writes
 * bare cookies, for the middleware's forwarded request. Returns the names written.
 */
export function writeSessionValue(cookies: CookieWriter, value: string, present: string[], options?: SessionCookieOptions): string[];
export function writeSessionValue(cookies: BareCookieWriter, value: string, present: string[], options: false): string[];
export function writeSessionValue(
  cookies: CookieWriter | BareCookieWriter,
  value: string,
  present: string[],
  options: SessionCookieOptions | false = sessionCookieOptions(),
): string[] {
  const names = splitSessionValue(value).map((chunk, i) => {
    const name = sessionChunkName(i);
    if (options) (cookies as CookieWriter).set(name, chunk, options);
    else (cookies as BareCookieWriter).set(name, chunk);
    return name;
  });
  for (const name of present) {
    if (!names.includes(name)) cookies.delete(name);
  }
  return names;
}

/** Deletes the session cookie and every chunk in `present`. */
export function deleteSessionCookies(cookies: { delete(name: string): unknown }, present: string[]): void {
  for (const name of new Set([SESSION_COOKIE_NAME, ...present])) cookies.delete(name);
}
