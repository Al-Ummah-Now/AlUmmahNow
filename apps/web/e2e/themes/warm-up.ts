import type { FullConfig } from '@playwright/test';

/**
 * Compiles, one at a time and with no page open, what every page asks the dev server for. A route's
 * first request compiles it and rewrites shared chunks (app/layout.js); a page that is downloading
 * them meanwhile can get a cut file ("SyntaxError: Invalid or unexpected token"), never hydrates, and
 * its test waits out its timeout. On a cold server the first page did that to itself: its thumbnails
 * answer 404, which compiles the not-found route (account-menu's beforeAll, 180 s).
 */
export default async function warmUp(config: FullConfig) {
  const { baseURL } = config.projects[0].use;
  for (const path of ['/en', '/thumb/warm-up.jpg', '/api/auth/token', '/api/errors']) {
    await fetch(`${baseURL}${path}`, { signal: AbortSignal.timeout(120_000) }).then((r) => r.arrayBuffer());
  }
}
