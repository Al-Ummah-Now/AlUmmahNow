'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorRefFromDigest, errorScreenStrings, friendlyErrorKind, type FriendlyErrorKind } from '@al-ummah/shared-types';
import { reportError } from '@/lib/errors/reporter';
import { recoverFromVersionSkew } from '@/lib/version-skew/recovery';
import { ErrorScreen, type ErrorAction } from './ErrorScreen';

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

/** This document's HTTP status, when the Worker set it (lib/seo/unavailable.ts: a failed page is 503). */
function documentStatus(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = (window as unknown as Record<string, unknown>).__aunHttpStatus;
  return typeof value === 'number' ? value : undefined;
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
  // Same reference the server logged for this render error (digest), else a new one
  const [reference, setReference] = useState(() => (error.digest ? errorRefFromDigest(error.digest) : ''));
  // The page's real status after mount (the Worker answers a failed page render 503), so the code
  // line matches the response: "Error 503", never "Error 500" on a 503
  const [httpStatus, setHttpStatus] = useState<number | undefined>(undefined);
  useEffect(() => setHttpStatus(documentStatus()), []);
  const detected = useMemo(
    () => forcedKind ?? friendlyErrorKind(error, { online: typeof navigator === 'undefined' ? true : navigator.onLine, digest: error.digest }),
    [error, forcedKind],
  );
  const kind: FriendlyErrorKind = detected === 'server' && httpStatus === 503 ? 'unavailable' : detected;

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
      // Reported once: the 503 swap below changes only the words shown
      extra: { boundary, screen: detected, ...(error.digest ? { serverRendered: true } : {}) },
    });
    if (ref) setReference(ref);
  }, [error, boundary, detected, fixedLocale]);

  if (skew) return null;

  const s = errorScreenStrings(locale);
  const home = `/${locale}`;

  const primary: ErrorAction =
    kind === 'update' ? { label: s.reload, icon: 'update', onClick: () => window.location.reload() }
    : kind === 'session' ? { label: s.signIn, icon: 'session', onClick: () => window.location.assign(`/api/auth/start?returnTo=${encodeURIComponent(window.location.pathname)}`) }
    : kind === 'notFound' || kind === 'gone' ? { label: s.goHome, icon: 'home', href: home }
    : reset ? { label: s.tryAgain, icon: 'retry', onClick: () => reset() }
    : { label: s.reload, icon: 'retry', onClick: () => window.location.reload() };
  const secondary: ErrorAction[] = kind === 'notFound' || kind === 'gone' ? [] : [{ label: s.goHome, icon: 'home', href: home }];

  return (
    <ErrorScreen
      locale={locale}
      kind={kind}
      role="alert"
      testId="friendly-error"
      primary={primary}
      secondary={secondary}
      reference={reference || undefined}
      contactHref={`/${locale}/contact${reference ? `?ref=${encodeURIComponent(reference)}` : ''}`}
    />
  );
}
