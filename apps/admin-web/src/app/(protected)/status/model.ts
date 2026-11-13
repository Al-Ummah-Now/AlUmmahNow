import { STATUS_PAGE_URLS } from '@al-ummah/shared-types';

/** The public page for this admin's environment, from its admin-api host (admin.api[.env] → status[.env]); the local stack's on localhost. */
export function publicStatusUrl(adminApiUrl = process.env.ADMIN_API_URL ?? ''): string {
  const m = /^https:\/\/admin\.api(\.qa|\.stage)?\.alummahnow\.net/.exec(adminApiUrl);
  if (m) return m[1] === '.qa' ? STATUS_PAGE_URLS.qa : m[1] === '.stage' ? STATUS_PAGE_URLS.stage : STATUS_PAGE_URLS.production;
  return /^https?:\/\/(localhost|127\.0\.0\.1)/.test(adminApiUrl) ? 'http://localhost:3095' : STATUS_PAGE_URLS.qa;
}
