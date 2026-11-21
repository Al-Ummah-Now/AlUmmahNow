'use client';

import { useEffect, useMemo, useState } from 'react';
import { ERROR_KIND_STATUS, ERROR_PAGE_ICONS, errorCodeLabel, errorKindIcon, errorScreenStrings, type ErrorPageIcon, type FriendlyErrorKind } from '@al-ummah/shared-types';
import { boundaryOutcome, handleBoundaryError } from '@/lib/errors/boundary';
import { reportError } from '@/lib/errors/reporter';
import { recoverFromVersionSkew } from '@/lib/version-skew';
import { primaryButtonClass, secondaryButtonClass } from './ui';

interface FriendlyErrorProps {
  locale: string;
  kind: FriendlyErrorKind;
  /** ERR-XXXX-XXXX shown with a copy button; none for a plain 404. */
  reference?: string;
  /** "Try again" (the boundary's reset); without it the screen offers a reload. */
  onRetry?: () => void;
  /** Smaller, for a segment boundary inside the admin layout. */
  inline?: boolean;
  /** The admin app's own wording for the home link ("Go to Dashboard"); defaults to the shared copy. */
  homeLabel?: string;
}

/**
 * The only thing a user sees when something fails: the shared error card (frosted glass, badge, the
 * "Error 404" line, words and actions as on every Al Ummah Now app; wiki guides/error-pages.md),
 * en/ar with RTL, an action that fits, Go back, and the reference to quote. Never a stack, a
 * framework URL or the error's own text.
 */
export function FriendlyError({ locale, kind, reference, onRetry, inline = false, homeLabel }: FriendlyErrorProps) {
  const s = errorScreenStrings(locale);
  const copy = s.kinds[kind];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const reload = () => window.location.reload();
  const home = homeLabel || s.goHome;
  const status = ERROR_KIND_STATUS[kind];
  // After mount only (the server can't know the history)
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => setCanGoBack(window.history.length > 1), []);

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
          <p className="ep-body">{copy.body}</p>
        </div>
        {reference && <ReferenceBox reference={reference} label={s.reference} hint={s.referenceHint} copyLabel={s.copy} copiedLabel={s.copied} />}
        <footer className="ep-foot">
          <div className="ep-actions">
            {canGoBack ? (
              <button type="button" onClick={() => window.history.back()} className={`${secondaryButtonClass} ep-btn`} data-testid="friendly-error-back">
                <Icon name="back" />
                <span>{s.goBack}</span>
              </button>
            ) : null}
            {showHome && (
              <a href="/dashboard" className={`${secondaryButtonClass} ep-btn`}>
                <Icon name="home" />
                <span>{home}</span>
              </a>
            )}
            {primary.href ? (
              <a href={primary.href} className={`${primaryButtonClass} ep-btn`} data-testid="friendly-error-action">
                {primaryInner}
              </a>
            ) : (
              <button type="button" onClick={primary.onClick} className={`${primaryButtonClass} ep-btn`} data-testid="friendly-error-action">
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
export function BoundaryError({ error, reset, locale, inline, homeLabel }: { error: Error & { digest?: string }; reset?: () => void; locale: string; inline?: boolean; homeLabel?: string }) {
  const outcome = useMemo(() => boundaryOutcome(error, { online: typeof navigator === 'undefined' ? undefined : navigator.onLine }), [error]);

  useEffect(() => {
    handleBoundaryError(error, outcome, { recover: recoverFromVersionSkew, report: reportError });
  }, [error, outcome]);

  if (outcome.skew) return null;
  return <FriendlyError locale={locale} kind={outcome.kind} reference={outcome.ref} onRetry={reset} inline={inline} homeLabel={homeLabel} />;
}
