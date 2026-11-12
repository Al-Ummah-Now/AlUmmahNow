/**
 * Release regression: a signed-out visitor's browser console stays clean.
 *
 * Seen on QA and production (2026-11-09): every page of the videos site logged
 * "Failed to load resource: 401" for the silent sign-in probe, the credentialed
 * GET {AUTH}/session/accounts each tab sends to learn whether the browser is
 * signed in on another app. "Not signed in" is a normal answer: the auth server
 * now says 200 {"accounts":[]} (AlUmmahNowAuth#272), and nothing on the page
 * may fail.
 *
 * Home, watch, channel and search, each in a fresh tab (the probe runs once
 * per tab), in Chrome, Firefox and WebKit (projects in
 * playwright.release.config.ts): the probe happens, answers 200 with no
 * accounts, the auth host answers nothing with 4xx/5xx, and the page logs no
 * console error. No user, no data: safe on any target.
 */
import { test, expect, type BrowserContext, type ConsoleMessage, type Page, type Response } from '@playwright/test';
import { target, releaseEnv } from './targets';
import { watchUrl } from './videos';
import { useOwnVideos } from './own-videos';

// quarantined: #1020 @meywd: on the local stack WebKit never fires the load event (every navigation times out)
test.fixme(({ browserName }) => browserName === 'webkit' && releaseEnv() === 'local', 'quarantined: #1020 @meywd: WebKit load event on the local stack');

// This spec's own videos (created in beforeAll, deleted in afterAll): never the seed's or the newest public one
const own = useOwnVideos(test);
// It signs a user up through the auth server: traces and video would hold the password and code
test.use({ trace: 'off', video: 'off' });

/** How long a page may stay quiet after the probe before it counts as settled. */
const SETTLE_MS = 3000;

interface Visit {
  consoleErrors: string[];
  authFailures: string[];
  probe: { status: number; body: unknown } | null;
}

/** Opens `url` in a new tab of `context` and records what the page did. */
async function visit(context: BrowserContext, url: string): Promise<Visit> {
  const page: Page = await context.newPage();
  const authHost = new URL(target().auth).host;
  const result: Visit = { consoleErrors: [], authFailures: [], probe: null };
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') result.consoleErrors.push(`${msg.text()} (${msg.location().url || 'page'})`);
  });
  page.on('pageerror', (err) => result.consoleErrors.push(`uncaught: ${err.message}`));
  page.on('response', (res: Response) => {
    if (new URL(res.url()).host === authHost && res.status() >= 400) result.authFailures.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
  page.on('requestfailed', (req) => {
    if (new URL(req.url()).host === authHost) result.authFailures.push(`failed ${req.method()} ${req.url()}: ${req.failure()?.errorText}`);
  });

  const probe = page.waitForResponse((res) => res.url() === `${target().auth}/session/accounts` && res.request().method() === 'GET', { timeout: 30000 });
  await page.goto(url, { waitUntil: 'load' });
  const res = await probe.catch(() => null);
  if (res) result.probe = { status: res.status(), body: await res.json().catch(() => null) };
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  await page.close();
  return result;
}

function expectClean(name: string, v: Visit): void {
  expect.soft(v.probe, `${name}: the silent sign-in probe (GET /session/accounts) never ran`).not.toBeNull();
  expect.soft(v.probe, `${name}: a signed-out probe answers 200 with no accounts`).toEqual({ status: 200, body: { accounts: [] } });
  expect.soft(v.authFailures, `${name}: 4xx/5xx or failed requests to the auth host`).toEqual([]);
  expect.soft(v.consoleErrors, `${name}: console errors for a signed-out visitor`).toEqual([]);
}

test.describe('Release: signed-out visitors get a clean console', () => {
  test('home, watch, channel and search', async ({ browser }) => {
    test.setTimeout(240000);
    const web = target().web;
    // Seeded fixtures: never the newest item of a shared list (another spec's upload, still encoding)
    const { videos, channelId } = await own.all();
    const videoId = videos.landscape.id;
    const pages: Array<[string, string]> = [
      ['home', `${web}/en`],
      ['watch', watchUrl(videoId)],
      ['channel', `${web}/en/channels/${encodeURIComponent(channelId)}`],
      ['search', `${web}/en/search?q=${encodeURIComponent('quran')}`],
    ];

    // A first-time visitor: no cookies at all (no consent answer, no session)
    const context = await browser.newContext();
    try {
      for (const [name, url] of pages) {
        await test.step(`${name}: ${url}`, async () => expectClean(name, await visit(context, url)));
      }
    } finally {
      await context.close();
    }
  });
});
