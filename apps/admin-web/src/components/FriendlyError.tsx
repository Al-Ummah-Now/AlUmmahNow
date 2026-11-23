'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ERROR_KIND_STATUS, ERROR_PAGE_ICONS, errorBodySentences, errorCodeLabel, errorKindIcon, errorPageTitle, errorScreenStrings, type ErrorPageIcon, type FriendlyErrorKind } from '@al-ummah/shared-types';
import { boundaryOutcome, handleBoundaryError } from '@/lib/errors/boundary';
import { reportError } from '@/lib/errors/reporter';
import { recoverFromVersionSkew } from '@/lib/version-skew';
import { useErrorTabTitle } from '@/hooks/useErrorTabTitle';

interface FriendlyErrorProps {
  locale: string;
  kind: FriendlyErrorKind;
  /** ERR-XXXX-XXXX shown with a copy button; none for a plain 404. */
  reference?: string;
  /** "Try again" (the boundary's reset); without it the screen offers a reload. */
  onRetry?: () => void;
  /** Smaller, for a segment boundary inside the admin layout. */
  inline?: boolean;
}

/** The family's buttons (aun-error-page.css), never admin's own: the same on every app. */
const PRIMARY = 'ep-btn ep-btn-primary';
const SECONDARY = 'ep-btn ep-btn-secondary';

/**
 * "Still stuck? Contact us": the public contact page on the videos site of this admin's domain
 * (admin.<domain> → videos.<domain>), with the reference. None on a host without that shape (local dev).
 */
export function contactHrefFor(location: { protocol: string; host: string }, locale: string, reference?: string): string | undefined {
  if (!location.host.startsWith('admin.')) return undefined;
  return `${location.protocol}//videos.${location.host.slice('admin.'.length)}/${locale === 'ar' ? 'ar' : 'en'}/contact${reference ? `?ref=${encodeURIComponent(reference)}` : ''}`;
}

/**
 * The only thing a user sees when something fails: the shared error card (frosted glass, badge, the
 * "Error 404" line, words and actions as on every Al Ummah Now app; wiki guides/error-pages.md),
 * en/ar with RTL, an action that fits, Go back on a 404, the reference to quote and "Still stuck?
 * Contact us". Never a stack, a framework URL or the error's own text.
 */
export function FriendlyError({ locale, kind, reference, onRetry, inline = false }: FriendlyErrorProps) {
  const s = errorScreenStrings(locale);
  const copy = s.kinds[kind];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const reload = () => window.location.reload();
  const home = s.goHome;
  const status = ERROR_KIND_STATUS[kind];
  const lost = kind === 'notFound' || kind === 'gone';
  // After mount only (the server can't know the history or the host). Go back only where the
  // videos site offers it (404/410), so the 500 actions are Home page + Try again everywhere
  const [canGoBack, setCanGoBack] = useState(false);
  const [contactHref, setContactHref] = useState<string | undefined>(undefined);
  useEffect(() => {
    setCanGoBack(lost && window.history.length > 1);
    setContactHref(contactHrefFor(window.location, locale, reference));
  }, [lost, locale, reference]);
  // The tab says what happened, in the family's format, whatever title the route's metadata streams in
  // (useErrorTabTitle); the 404 page's server HTML already carries it (app/not-found.tsx)
  useErrorTabTitle(errorPageTitle(locale, copy.title));

  let primary: { label: string; icon: ErrorPageIcon; onClick?: () => void; href?: string };
  if (kind === 'update') primary = { label: s.reload, icon: 'update', onClick: reload };
  else if (kind === 'session') primary = { label: s.signIn, icon: 'session', href: '/login' };
  else if (kind === 'notFound' || kind === 'gone') primary = { label: home, icon: 'home', href: '/dashboard' };
  else primary = { label: s.tryAgain, icon: 'retry', onClick: onRetry ?? reload };
  const showHome = kind !== 'notFound' && kind !== 'gone' && kind !== 'session';
  const primaryInner = (
    <>
      <Icon name={primary.icon} />
      <span>{primary.label}</span>
    </>
  );

  return (
    <div
      lang={locale}
      dir={dir}
      role={kind === 'notFound' || kind === 'gone' ? undefined : 'alert'}
      className={`ep${inline ? ' ep-inline' : ''}`}
      data-testid="friendly-error"
      data-kind={kind}
      data-error-status={status}
    >
      <section className="ep-card" aria-labelledby="ep-title">
        <div className="ep-head">
          <span className="ep-badge" aria-hidden="true">
            <Icon name={errorKindIcon(kind)} />
          </span>
          <div className="ep-heading">
            {status ? <p className="ep-code">{errorCodeLabel(locale, status)}</p> : null}
            <h1 className="ep-title" id="ep-title">{copy.title}</h1>
          </div>
          <p className="ep-body">{errorBodySentences(copy.body).map((s, i) => <Fragment key={i}>{i ? ' ' : null}<span className="ep-s">{s}</span></Fragment>)}</p>
        </div>
        {reference && <ReferenceBox reference={reference} label={s.reference} hint={s.referenceHint} copyLabel={s.copy} copiedLabel={s.copied} />}
        <footer className="ep-foot">
          {contactHref ? (
            <p className="ep-help">
              {s.needHelp} <a href={contactHref}>{s.contactUs}</a>
            </p>
          ) : null}
          <div className="ep-actions">
            {canGoBack ? (
              <button type="button" onClick={() => window.history.back()} className={SECONDARY} data-testid="friendly-error-back">
                <Icon name="back" />
                <span>{s.goBack}</span>
              </button>
            ) : null}
            {showHome && (
              <a href="/dashboard" className={SECONDARY}>
                <Icon name="home" />
                <span>{home}</span>
              </a>
            )}
            {primary.href ? (
              <a href={primary.href} className={PRIMARY} data-testid="friendly-error-action">
                {primaryInner}
              </a>
            ) : (
              <button type="button" onClick={primary.onClick} className={PRIMARY} data-testid="friendly-error-action">
                {primaryInner}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

/** The card's icons: the shared lucide shapes (@al-ummah/shared-types ERROR_PAGE_ICONS). */
function Icon({ name }: { name: ErrorPageIcon }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name} dangerouslySetInnerHTML={{ __html: ERROR_PAGE_ICONS[name] }} />
  );
}

function ReferenceBox({ reference, label, hint, copyLabel, copiedLabel }: { reference: string; label: string; hint: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="ep-ref">
      <div className="ep-ref-row">
        <span className="ep-ref-label">{label}</span>
        <code className="ep-ref-code" dir="ltr" data-testid="friendly-error-ref">
          {reference}
        </code>
        <button type="button" onClick={copyRef} className="ep-ref-copy" data-testid="friendly-error-copy">
          <Icon name="copy" />
          <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
      <p className="ep-ref-hint">{hint}</p>
    </div>
  );
}

/**
 * A boundary's screen: works out the reference and kind, runs the skew
 * recovery and reports once mounted. Renders nothing while a version-skew
 * reload takes over.
 */
export function BoundaryError({ error, reset, locale, inline }: { error: Error & { digest?: string }; reset?: () => void; locale: string; inline?: boolean }) {
  const outcome = useMemo(() => boundaryOutcome(error, { online: typeof navigator === 'undefined' ? undefined : navigator.onLine }), [error]);

  useEffect(() => {
    handleBoundaryError(error, outcome, { recover: recoverFromVersionSkew, report: reportError });
  }, [error, outcome]);

  if (outcome.skew) return null;
  return <FriendlyError locale={locale} kind={outcome.kind} reference={outcome.ref} onRetry={reset} inline={inline} />;
}
