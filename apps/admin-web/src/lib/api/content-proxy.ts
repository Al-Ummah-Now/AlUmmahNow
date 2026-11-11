/**
 * What the browser may call through the content pass-through
 * (app/api/content/[...path]/route.ts): an explicit list of admin-api
 * /api/content paths and methods. Anything else answers 404 without reaching
 * admin-api, so the browser cannot use the admin's token for more than the
 * lists need. admin-api still checks every permission itself.
 *
 * Add a rule when a list moves to the client (Channels, Users, Comments, ...).
 */

export type ProxyMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Rule {
  method: ProxyMethod;
  /** Matched against the joined, decoded path segments (no leading slash). */
  path: RegExp;
}

const ID = '[^/]{1,200}';

export const CONTENT_PROXY_RULES: readonly Rule[] = [
  // Reads the lists use
  { method: 'GET', path: /^permissions$/ },
  { method: 'GET', path: /^(videos|channels|users|comments|playlists|posts)$/ },
  // Videos list: inline and bulk actions (admin-api audits each one)
  { method: 'POST', path: new RegExp(`^videos/${ID}/(unpublish|republish)$`) },
  { method: 'DELETE', path: new RegExp(`^videos/${ID}$`) },
  // Live streaming page (admin-api checks live:manage and audits each change)
  { method: 'GET', path: /^live\/(settings|sessions|compare|audit)$/ },
  { method: 'PUT', path: /^live\/settings$/ },
  { method: 'PUT', path: new RegExp(`^live/overrides/${ID}$`) },
  { method: 'DELETE', path: new RegExp(`^live/overrides/${ID}$`) },
  { method: 'POST', path: new RegExp(`^live/streams/${ID}/move$`) },
  { method: 'POST', path: new RegExp(`^live/sessions/${ID}/end$`) },
];

/** True when `segments` are a path the pass-through serves for `method`. */
export function isAllowedContentPath(method: string, segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  if (segments.some((s) => !s || s === '.' || s === '..' || s.includes('/') || s.includes('\\'))) return false;
  const path = segments.join('/');
  return CONTENT_PROXY_RULES.some((rule) => rule.method === method && rule.path.test(path));
}

/** The admin-api path for allowed segments, each segment encoded again. */
export function upstreamContentPath(segments: readonly string[], search: string): string {
  const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `/api/content/${segments.map(encodeURIComponent).join('/')}${query}`;
}

/** Largest query string and JSON body the pass-through forwards. */
export const MAX_QUERY_LENGTH = 2000;
export const MAX_BODY_BYTES = 16 * 1024;
