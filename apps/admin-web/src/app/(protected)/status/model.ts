import { STATUS_PAGE_URLS } from '@al-ummah/shared-types';

/** The public page for this admin's environment, from its admin-api host (admin.api[.env] → status[.env]); the local stack's on localhost. */
export function publicStatusUrl(adminApiUrl = process.env.ADMIN_API_URL ?? ''): string {
  const m = /^https:\/\/admin\.api(\.qa|\.stage)?\.alummahnow\.net/.exec(adminApiUrl);
  if (m) return m[1] === '.qa' ? STATUS_PAGE_URLS.qa : m[1] === '.stage' ? STATUS_PAGE_URLS.stage : STATUS_PAGE_URLS.production;
  return /^https?:\/\/(localhost|127\.0\.0\.1)/.test(adminApiUrl) ? 'http://localhost:3095' : STATUS_PAGE_URLS.qa;
}

/**
 * A failed webhook delivery's reason in the admin's language. admin-api stores
 * "webhook answered <status>" for an HTTP answer and the fetch error (timeout, DNS, TLS) otherwise.
 */
export function deliveryErrorKey(error: string): { key: 'statusPage.subs.deliveryHttp'; status: string } | { key: 'statusPage.subs.deliveryUnreachable' } {
  const m = /^webhook answered (\d{3})$/.exec(error.trim());
  return m ? { key: 'statusPage.subs.deliveryHttp', status: m[1]! } : { key: 'statusPage.subs.deliveryUnreachable' };
}
