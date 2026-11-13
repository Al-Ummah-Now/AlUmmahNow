/**
 * Cloudflare Turnstile in the browser (docs/features/bot-protection.md).
 *
 * getTurnstileToken() renders a managed widget with appearance "interaction-only":
 * almost every visitor sees nothing and gets a token in about a second. Only when
 * Cloudflare needs a click does the box appear (a small fixed panel, labelled, with
 * focus moved into it). Cloudflare's test site keys load the same-origin stub
 * (/turnstile/stub.js) instead of challenges.cloudflare.com, so tests never call it.
 */
import { logger } from '@/lib/logger-client';

export const TURNSTILE_HEADER = 'X-Turnstile-Token';
const API_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const STUB_SCRIPT = '/turnstile/stub.js';
const TIMEOUT_MS = 120_000;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Cloudflare's documented test site keys (1x… pass, 2x… block, 3x… interactive). */
export function isTestSiteKey(siteKey: string): boolean {
  return /^[123]x0{20,}[A-F]{2}$/.test(siteKey);
}

const loads = new Map<string, Promise<TurnstileApi>>();

function loadApi(siteKey: string): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  const src = isTestSiteKey(siteKey) ? STUB_SCRIPT : API_SCRIPT;
  const existing = loads.get(src);
  if (existing) return existing;
  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      // api.js defines window.turnstile synchronously when it runs
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile_unavailable'));
    };
    script.onerror = () => reject(new Error('turnstile_script_failed'));
    document.head.appendChild(script);
  });
  promise.catch(() => loads.delete(src));
  loads.set(src, promise);
  return promise;
}

export interface TurnstileOptions {
  siteKey: string;
  /** Shown in the Turnstile analytics, e.g. "comment", "report", "contact" */
  action: string;
  locale: 'en' | 'ar';
  /** Accessible name of the panel when Cloudflare asks for a click */
  dialogLabel: string;
}

/** A token for one submission, or null when the check could not run or did not pass. */
export async function getTurnstileToken(opts: TurnstileOptions): Promise<string | null> {
  let api: TurnstileApi;
  try {
    api = await loadApi(opts.siteKey);
  } catch (error) {
    logger.warn('[turnstile] Script did not load', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }

  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', opts.dialogLabel);
  panel.setAttribute('data-testid', 'turnstile-panel');
  panel.dir = opts.locale === 'ar' ? 'rtl' : 'ltr';
  panel.tabIndex = -1;
  // Hidden until Cloudflare needs a click (before-interactive-callback)
  panel.style.cssText =
    'position:fixed;inset-inline:0;bottom:1rem;margin-inline:auto;width:max-content;max-width:calc(100vw - 2rem);z-index:2147483000;display:none;padding:.5rem;border-radius:.75rem;background:var(--fanous-color-surface-raised);border:1px solid var(--m-card-edge)';
  document.body.appendChild(panel);

  return new Promise<string | null>((resolve) => {
    let widgetId: string | null = null;
    let done = false;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        if (widgetId) api.remove(widgetId);
      } catch {
        // already gone
      }
      panel.remove();
      resolve(token);
    };
    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS);
    try {
      widgetId = api.render(panel, {
        sitekey: opts.siteKey,
        action: opts.action,
        language: opts.locale,
        appearance: 'interaction-only',
        'response-field': false,
        callback: (token: string) => finish(token),
        'error-callback': () => {
          finish(null);
          return true;
        },
        'expired-callback': () => finish(null),
        'timeout-callback': () => finish(null),
        'before-interactive-callback': () => {
          panel.style.display = 'block';
          panel.focus();
        },
        'after-interactive-callback': () => {
          panel.style.display = 'none';
        },
      });
    } catch (error) {
      logger.warn('[turnstile] Render failed', { error: error instanceof Error ? error.message : String(error) });
      finish(null);
    }
  });
}
