/**
 * Provider slowdowns vs real failures for the no-retry upload specs (uploads, media-delivery,
 * audio-tracks, upload-reuse). They make real Bunny uploads, so Playwright never retries them; a
 * few minutes of stage or Bunny slowness then failed a whole release (v2026.11.19.5: four specs
 * timed out in 16:26–16:30 UTC while the rest of stage was healthy).
 *
 * providerAttempts() runs the test body as an attempt in a fresh browser context (a fresh user and
 * a fresh upload: the body signs up its own), with its own time budget:
 * - it passes: done;
 * - it fails on a timeout, or while a provider answered a gateway error (502/503/504/52x, any 5xx
 *   from Bunny, or the TUS proxy's 423 "Bunny is not answering, retry"): the attempt's videos are
 *   deleted and the body runs ONCE more;
 * - the second attempt fails the same way AND the provider was measurably in trouble during it
 *   (one of those errors, a request that took over SLOW_MS or was still waiting that long, or a
 *   Node-side API call that got no answer):
 *   the test is skipped with #929, like a slow encode (encode.ts);
 * - anything else fails hard: an assertion on a value, a 4xx, a permission or state error, a 500
 *   from our own API, or a timeout while every provider answered promptly.
 *
 * Imports stay inside e2e/release (the release suite runs from a copy).
 */
import { appendFileSync } from 'fs';
import { test, type Browser, type BrowserContext, type Page, type Request, type TestInfo } from '@playwright/test';
import { target } from './targets';
import { classifyAnswer, decideAfterFailure, isBunnyHost, isTimeout, type ProviderEvent } from './provider-rules';

import { SLOW_MS } from './provider-rules';

export { SLOW_MS };

const SLOW_ISSUE = 'https://github.com/Al-Ummah-Now/AlUmmahNow/issues/929';

const events: ProviderEvent[] = [];

/** Hosts whose health decides: ours (every app of the target) and Bunny. Third-party scripts do not. */
function providerHost(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (isBunnyHost(host) || /(^|\.)alummahnow\.net$/.test(host)) return host;
  const t = target();
  for (const base of [t.web, t.api, t.auth, t.adminWeb]) {
    try {
      if (base && new URL(base).hostname === host) return host;
    } catch {
      /* not a URL */
    }
  }
  return null;
}

function note(kind: ProviderEvent['kind'], detail: string): void {
  events.push({ at: Date.now(), kind, detail });
  if (events.length > 500) events.splice(0, events.length - 500);
}

/** Records one HTTP answer (browser contexts, and Node-side callers: apiFetch). */
export function noteProviderResponse(url: string, status: number, ms: number, method = 'GET'): void {
  const host = providerHost(url);
  if (!host) return;
  const path = new URL(url).pathname;
  const kind = classifyAnswer(host, path, status, ms);
  if (kind === 'gateway') note(kind, `${method} ${host}${path} → ${status}`);
  else if (kind === 'slow') note(kind, `${method} ${host}${path} took ${Math.round(ms / 1000)} s`);
}

/** Records a request that got no answer at all (Node-side callers). */
export function noteProviderNoAnswer(url: string, reason: string, method = 'GET'): void {
  const host = providerHost(url);
  if (host) note('no-answer', `${method} ${host} ${reason}`.slice(0, 200));
}

const inFlight = new WeakMap<BrowserContext, Map<Request, number>>();

/**
 * Watches every request of a browser context for provider trouble: gateway errors and slow answers.
 * A failed request is not counted (a closed page or context aborts its own); one still waiting is,
 * when the attempt fails (noteStalledRequests).
 */
export function watchProviderHealth(context: BrowserContext): void {
  const pending = new Map<Request, number>();
  inFlight.set(context, pending);
  context.on('request', (req) => pending.set(req, Date.now()));
  context.on('requestfailed', (req) => pending.delete(req));
  context.on('requestfinished', (req) => {
    pending.delete(req);
    const timing = req.timing();
    const ms = timing.responseEnd > 0 ? timing.responseEnd : 0;
    void req
      .response()
      .then((res) => noteProviderResponse(req.url(), res?.status() ?? 0, ms, req.method()))
      .catch(() => undefined);
  });
}

/** Records the context's provider requests that have been waiting longer than SLOW_MS (a hung navigation never finishes). */
export function noteStalledRequests(context: BrowserContext): void {
  const now = Date.now();
  for (const [req, started] of inFlight.get(context) ?? []) {
    const host = providerHost(req.url());
    if (host && now - started > SLOW_MS) note('slow', `${req.method()} ${host}${new URL(req.url()).pathname} still waiting after ${Math.round((now - started) / 1000)} s`);
  }
}

/** Provider trouble recorded since `since` (ms). */
export function providerTroubleSince(since: number): ProviderEvent[] {
  return events.filter((e) => e.at >= since);
}

const isSkip = (error: unknown, testInfo: TestInfo) =>
  testInfo.expectedStatus === 'skipped' || (error as { constructor?: { name?: string } } | null)?.constructor?.name === 'TestSkipError';

const firstLine = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim()) ?? 'error';

export interface Attempt {
  /** 1 or 2 */
  index: number;
  /** A page in this attempt's own browser context */
  page: Page;
  /** Another context for this attempt (watched and cleaned up like the first) */
  newContext(): Promise<BrowserContext>;
  /** A cleanup step for this attempt, run if the attempt fails (the body's own finally covers success) */
  onCleanup(run: () => Promise<unknown>): void;
}

interface UploadSeen {
  videoId: string;
  authorization?: string;
  channelId?: string;
}

/** Deletes a failed attempt's uploads with the uploader's own request credentials (trash, then for good). */
async function deleteUploads(uploads: UploadSeen[]): Promise<void> {
  for (const u of uploads) {
    if (!u.authorization) continue;
    const headers: Record<string, string> = { Authorization: u.authorization, 'X-Turnstile-Token': 'XXXX.DUMMY.TOKEN.XXXX', ...(u.channelId ? { channelId: u.channelId } : {}) };
    for (const path of [`/api/videos/${u.videoId}`, `/api/videos/${u.videoId}/permanent`]) {
      const res = await fetch(`${target().api}${path}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (res && res.status >= 400 && res.status !== 404) console.warn(`[provider-retry] cleanup DELETE ${path} answered ${res.status} (left to the run teardown)`);
    }
  }
}

/**
 * Runs `body` as up to two attempts (see the file comment). `perAttemptMs` is what one attempt
 * may take (the test's own timeout before this); the test gets room for two plus cleanup.
 */
export async function providerAttempts(
  browser: Browser,
  testInfo: TestInfo,
  opts: { perAttemptMs?: number; what?: string },
  body: (attempt: Attempt) => Promise<void>,
): Promise<void> {
  const perAttemptMs = opts.perAttemptMs ?? testInfo.timeout;
  testInfo.setTimeout(perAttemptMs * 2 + 3 * 60_000);
  const what = opts.what ?? testInfo.title;
  let firstError: unknown;

  for (let index = 1; index <= 2; index++) {
    const started = Date.now();
    const contexts: BrowserContext[] = [];
    const uploads: UploadSeen[] = [];
    const cleanups: Array<() => Promise<unknown>> = [];
    const newContext = async () => {
      const context = await browser.newContext();
      contexts.push(context);
      watchProviderHealth(context);
      context.on('response', async (res) => {
        if (res.request().method() !== 'POST' || !/\/api\/videos\/upload\/initiate$/.test(new URL(res.url()).pathname)) return;
        const body = (await res.json().catch(() => ({}))) as { result?: { videoId?: string } };
        const videoId = body.result?.videoId;
        if (!videoId) return;
        // For the run's upload cap and leftover check (builders.ts recordResource; not imported: web-session imports this file)
        if (process.env.E2E_RUN_RESOURCES_FILE) appendFileSync(process.env.E2E_RUN_RESOURCES_FILE, `video ${videoId}\n`);
        const headers = res.request().headers();
        if (!uploads.some((u) => u.videoId === videoId)) uploads.push({ videoId, authorization: headers['authorization'], channelId: headers['channelid'] });
      });
      return context;
    };
    const page = await (await newContext()).newPage();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = body({ index, page, newContext, onCleanup: (fn) => cleanups.push(fn) });
    run.catch(() => undefined); // abandoned at the attempt deadline: its rejection is not unhandled
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error(`attempt ${index} of "${what}": Timeout ${perAttemptMs}ms exceeded`);
        e.name = 'TimeoutError';
        reject(e);
      }, perAttemptMs);
    });
    let failed = true;
    try {
      await Promise.race([run, deadline]);
      failed = false;
      return;
    } catch (error) {
      if (isSkip(error, testInfo)) throw error;
      for (const context of contexts) noteStalledRequests(context);
      const trouble = providerTroubleSince(started);
      const evidence = trouble.slice(0, 5).map((e) => e.detail).join('; ');
      const decision = decideAfterFailure(index, error, trouble);
      if (decision === 'fail') {
        if (index === 2) testInfo.annotations.push({ type: 'provider-retry', description: `attempt 1 failed: ${firstLine(firstError)}` });
        throw error;
      }
      if (decision === 'retry') {
        firstError = error;
        testInfo.annotations.push({
          type: 'provider-retry',
          description: `attempt 1 failed on ${isTimeout(error) ? 'a timeout' : 'a provider error'} (${firstLine(error)})${evidence ? `; provider: ${evidence}` : ''}; retrying once with a fresh upload`,
        });
        console.warn(`[provider-retry] ${what}: attempt 1 failed (${firstLine(error)}); retrying with a fresh upload`);
        // The workflow's Bunny upload cap allows one more upload per recorded retry (release-e2e.yml)
        if (process.env.E2E_RUN_RESOURCES_FILE) appendFileSync(process.env.E2E_RUN_RESOURCES_FILE, `provider-retry ${testInfo.testId}\n`);
        continue;
      }
      testInfo.annotations.push({ type: 'encode-timeout', description: `${what}: provider slowdown on both attempts (#929)` });
      test.skip(
        true,
        `${what}: the provider was slow or failing on both attempts (${evidence}; last: ${firstLine(error)}), a provider slowdown, not a product failure (${SLOW_ISSUE})`,
      );
    } finally {
      clearTimeout(timer);
      // Passed: the body cleaned up after itself. Failed: delete this attempt's uploads and data
      for (const context of contexts) await context.close().catch(() => undefined);
      if (failed) {
        for (const fn of cleanups.reverse()) await fn().catch((e: unknown) => console.warn(`[provider-retry] cleanup failed: ${firstLine(e)}`));
        await deleteUploads(uploads);
      }
    }
  }
}
