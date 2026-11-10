'use client';

import { useEffect, useState } from 'react';
import {
  createSkewRecovery,
  holdReload,
  setActiveSkewRecovery,
  type SkewState,
} from './recovery';
import { reportVersionSkew } from './report';

/**
 * Catches the errors a deploy causes in an open page (unhandled Server Action
 * "not found", ChunkLoadError, failed dynamic import) and recovers: a small
 * themed notice, then a reload. While an upload holds the reload
 * (useHoldReloadWhile), the notice says so and the reload waits until every
 * upload has finished. Mounted once in the root layout.
 */
export function VersionSkewProvider({ reload = defaultReload }: { reload?: () => void } = {}) {
  const [state, setState] = useState<SkewState>('idle');

  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    const recovery = createSkewRecovery({
      reload,
      report: reportVersionSkew,
      setState,
      storage,
    });
    setActiveSkewRecovery(recovery);

    const onRejection = (event: PromiseRejectionEvent) => {
      if (recovery.handle(event.reason, 'unhandledrejection')) event.preventDefault();
    };
    const onError = (event: ErrorEvent) => {
      if (recovery.handle(event.error ?? event.message, 'error')) event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    // Most callers catch a failed Server Action and show their own error, so
    // the answer itself is watched: Next marks an action id this build does
    // not have with this header (the error's message is never shown).
    const originalFetch = window.fetch;
    const watchedFetch: typeof fetch = async (...args) => {
      if (typeof originalFetch !== 'function') throw new TypeError('fetch is not available');
      const res = await originalFetch(...args);
      if (res.headers.get(ACTION_NOT_FOUND_HEADER) === '1') {
        recovery.handle(unrecognizedAction(), 'server-action-response');
      }
      return res;
    };
    window.fetch = watchedFetch;
    return () => {
      if (window.fetch === watchedFetch) window.fetch = originalFetch;
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
      setActiveSkewRecovery(null);
      recovery.dispose();
    };
  }, [reload]);

  if (state === 'idle') return null;
  const ar = typeof document !== 'undefined' && document.documentElement.lang.startsWith('ar');
  const text = MESSAGES[ar ? 'ar' : 'en'][state];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="version-skew-notice"
      data-state={state}
      dir={ar ? 'rtl' : 'ltr'}
      className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:end-4 z-[100] max-w-sm rounded-lg border border-border bg-card text-card-foreground shadow-lg px-4 py-3 text-sm"
    >
      <p className="font-medium text-brand-ink">{text.title}</p>
      <p className="mt-1 text-muted-foreground">{text.body}</p>
      {state === 'reload-blocked' && (
        <button
          type="button"
          onClick={reload}
          className="mt-2 rounded-md bg-brand px-3 py-1.5 text-on-brand hover:bg-brand-hover"
        >
          {text.action}
        </button>
      )}
    </div>
  );
}

/** Next's response header for a Server Action id the server does not have */
const ACTION_NOT_FOUND_HEADER = 'x-nextjs-action-not-found';

function unrecognizedAction(): Error {
  const error = new Error('Server Action "unknown" was not found on the server (x-nextjs-action-not-found)');
  error.name = 'UnrecognizedActionError';
  return error;
}

function defaultReload() {
  window.location.reload();
}

type Text = { title: string; body: string; action?: string };

const MESSAGES: Record<'en' | 'ar', Record<Exclude<SkewState, 'idle'>, Text>> = {
  en: {
    reloading: { title: 'A new version is available', body: 'Reloading…' },
    'waiting-for-uploads': {
      title: 'A new version is available',
      body: 'Your uploads keep going. The page reloads when they finish.',
    },
    'reload-blocked': {
      title: 'A new version is available',
      body: 'Please reload the page to continue.',
      action: 'Reload',
    },
  },
  ar: {
    reloading: { title: 'يتوفر إصدار جديد', body: 'جارٍ إعادة التحميل…' },
    'waiting-for-uploads': {
      title: 'يتوفر إصدار جديد',
      body: 'يستمر رفع ملفاتك، وستُعاد الصفحة عند انتهائه.',
    },
    'reload-blocked': {
      title: 'يتوفر إصدار جديد',
      body: 'يرجى إعادة تحميل الصفحة للمتابعة.',
      action: 'إعادة التحميل',
    },
  },
};

/** Holds any version-skew reload while `active` (an upload in flight). */
export function useHoldReloadWhile(active: boolean): void {
  useEffect(() => (active ? holdReload() : undefined), [active]);
}
