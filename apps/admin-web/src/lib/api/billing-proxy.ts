/**
 * What the browser may call through the billing pass-through
 * (app/api/billing/[...path]/route.ts): exactly the routes of admin-api's
 * billing router (apps/admin-api/src/routers/billing.router.ts). Anything else
 * answers 404 without reaching admin-api. admin-api still checks each billing
 * permission, the step-up on the risky ones, and audits every change.
 */
import type { ProxyMethod } from './content-proxy';

interface Rule {
  method: ProxyMethod;
  /** Matched against the joined, decoded path segments (no leading slash). */
  path: RegExp;
}

const ID = '[^/]{1,200}';
const PROVIDER = '(paygood|fake)';

export const BILLING_PROXY_RULES: readonly Rule[] = [
  // billing:read
  { method: 'GET', path: /^overview$/ },
  { method: 'GET', path: /^subscriptions$/ },
  { method: 'GET', path: new RegExp(`^subscriptions/${ID}$`) },
  { method: 'GET', path: new RegExp(`^users/${ID}$`) },
  // billing:manage
  { method: 'PUT', path: /^tax$/ },
  { method: 'PUT', path: /^prices$/ },
  { method: 'DELETE', path: new RegExp(`^prices/${ID}$`) },
  { method: 'POST', path: new RegExp(`^subscriptions/${ID}/cancel$`) },
  { method: 'POST', path: /^comps$/ },
  // billing:providers
  { method: 'PUT', path: new RegExp(`^providers/${PROVIDER}$`) },
  { method: 'PUT', path: new RegExp(`^providers/${PROVIDER}/credentials$`) },
  { method: 'POST', path: new RegExp(`^providers/${PROVIDER}/sync-prices$`) },
  // billing:refund
  { method: 'POST', path: new RegExp(`^payments/${ID}/refund$`) },
];

/** True when `segments` are a path the billing pass-through serves for `method`. */
export function isAllowedBillingPath(method: string, segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  if (segments.some((s) => !s || s === '.' || s === '..' || s.includes('/') || s.includes('\\'))) return false;
  const path = segments.join('/');
  return BILLING_PROXY_RULES.some((rule) => rule.method === method && rule.path.test(path));
}

/** The admin-api path for allowed segments, each segment encoded again. */
export function upstreamBillingPath(segments: readonly string[], search: string): string {
  const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `/api/billing/${segments.map(encodeURIComponent).join('/')}${query}`;
}
