'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorRefFromDigest, errorScreenStrings, friendlyErrorKind, type FriendlyErrorKind } from '@al-ummah/shared-types';
import { reportError } from '@/lib/errors/reporter';
import { recoverFromVersionSkew } from '@/lib/version-skew/recovery';

/**
 * The screen users see instead of a raw error (error boundaries). It reports
 * the error to the admin Errors page, shows a themed, localised message (en/ar,
 * RTL), one fitting action and the reference to quote, and links to the
 * contact page. Never a stack, a framework URL or the raw message.
 *
 * Version skew (a deploy while the page was open) is handed to the skew
 * recovery first (notice + reload, never during an upload): nothing else shows.
 *
 * Renders without providers (global-error has no layout), so the language
 * comes from the URL or <html lang>.
 */
export interface FriendlyErrorProps {
  error: Error & { digest?: string };
  reset?: () => void;
  /** Where it was caught, sent with the report (e.g. "root", "live") */
  boundary: string;
  /** Override the detected screen */
  kind?: FriendlyErrorKind;
  /** Routes that are one language only (app/ar/...) */
  locale?: 'en' | 'ar';
}

function pageLocale(): string {
  if (typeof window === 'undefined') return 'en';
  const seg = window.location.pathname.split('/')[1];
  if (seg === 'ar' || seg === 'en') return seg;
  return document.documentElement.lang?.startsWith('ar') ? 'ar' : 'en';
}

export function FriendlyError({ error, reset, boundary, kind: forcedKind, locale: fixedLocale }: FriendlyErrorProps) {
  const [locale, setLocale] = useState<string>(fixedLocale ?? 'en');
  const [skew, setSkew] = useState(false);
  const [copied, setCopied] = useState(false);
  // Same reference the server logged for this render error (digest), else a new one
  const [reference, setReference] = useState(() => (error.digest ? errorRefFromDigest(error.digest) : ''));
  const kind = useMemo(
    () => forcedKind ?? friendlyErrorKind(error, { online: typeof navigator === 'undefined' ? true : navigator.onLine, digest: error.digest }),
    [error, forcedKind],
  );

  useEffect(() => {
    setLocale(fixedLocale ?? pageLocale());
    if (recoverFromVersionSkew(error, `boundary:${boundary}`)) {
      // Reported by the skew recovery (kind "skew"); its notice takes over
      setSkew(true);
      return;
    }
    const ref = reportError(error, {
      kind: 'boundary',
      shown: true,
      // The release E2E trigger page: a test group (no alert mail, deleted after a day)
      ...(window.location.pathname.includes('/dev/error-test') ? { test: true } : {}),
      ...(error.digest ? { ref: errorRefFromDigest(error.digest) } : {}),
      extra: { boundary, screen: kind, ...(error.digest ? { serverRendered: true } : {}) },
    });
    if (ref) setReference(ref);
  }, [error, boundary, kind, fixedLocale]);

  if (skew) return null;

  const s = errorScreenStrings(locale);
  const copy = s.kinds[kind];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const home = `/${locale}`;

  const primary =
    kind === 'update' ? { label: s.reload, onClick: () => window.location.reload() }
    : kind === 'session' ? { label: s.signIn, onClick: () => window.location.assign(`/api/auth/start?returnTo=${encodeURIComponent(window.location.pathname)}`) }
    : kind === 'notFound' ? { label: s.goHome, onClick: () => window.location.assign(home) }
    : reset ? { label: s.tryAgain, onClick: () => reset() }
    : { label: s.reload, onClick: () => window.location.reload() };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main
      role="alert"
      aria-live="assertive"
      aria-labelledby="friendly-error-title"
      data-testid="friendly-error"
      data-kind={kind}
      dir={dir}
      lang={locale}
      className="flex min-h-[60vh] w-full items-center justify-center px-4 py-16"
    >
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card text-card-foreground shadow-lg p-8 sm:p-10 text-center">
        <div aria-hidden="true" className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            {kind === 'offline' ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.9a10 10 0 015.2-2.8M13.8 10.1A10 10 0 0119 12.9M2 8.8a15 15 0 014.2-2.5M12 20h.01" />
            ) : kind === 'update' ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.6 15A7 7 0 0018.4 15M18.4 9A7 7 0 005.6 9" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
            )}
          </svg>
        </div>
        <h1 id="friendly-error-title" className="text-2xl sm:text-3xl font-bold text-brand-ink">
          {copy.title}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">{copy.body}</p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={primary.onClick}
            className="rounded-lg bg-brand px-6 py-3 font-semibold text-on-brand shadow hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {primary.label}
          </button>
          {kind !== 'notFound' && (
            <a
              href={home}
              className="rounded-lg border border-border px-6 py-3 font-semibold text-card-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.goHome}
            </a>
          )}
        </div>

        {reference && (
          <div className="mt-8 rounded-xl bg-muted px-4 py-3 text-sm" data-testid="friendly-error-reference">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-muted-foreground">{s.reference}:</span>
              <code dir="ltr" className="font-mono font-semibold tracking-wide text-card-foreground" data-testid="error-reference">
                {reference}
              </code>
              <button type="button" onClick={onCopy} className="rounded-md px-2 py-1 text-brand-ink underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span aria-live="polite">{copied ? s.copied : s.copy}</span>
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{s.referenceHint}</p>
          </div>
        )}

        <p className="mt-6 text-sm text-muted-foreground">
          {s.needHelp}{' '}
          <a href={`/${locale}/contact${reference ? `?ref=${encodeURIComponent(reference)}` : ''}`} className="font-medium text-brand-ink underline underline-offset-2 hover:no-underline">
            {s.contactUs}
          </a>
        </p>
      </section>
    </main>
  );
}
