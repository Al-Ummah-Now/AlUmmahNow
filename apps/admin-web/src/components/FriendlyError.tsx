'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorScreenStrings, type FriendlyErrorKind } from '@al-ummah/shared-types';
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
 * The only thing a user sees when something fails: themed, en/ar with RTL,
 * an action that fits, and the reference to quote. Never a stack, a
 * framework URL or the error's own text.
 */
export function FriendlyError({ locale, kind, reference, onRetry, inline = false, homeLabel }: FriendlyErrorProps) {
  const s = errorScreenStrings(locale);
  const copy = s.kinds[kind];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const reload = () => window.location.reload();
  const home = homeLabel || s.goHome;

  let primary: { label: string; onClick?: () => void; href?: string };
  if (kind === 'update') primary = { label: s.reload, onClick: reload };
  else if (kind === 'session') primary = { label: s.signIn, href: '/login' };
  else if (kind === 'notFound') primary = { label: home, href: '/dashboard' };
  else primary = { label: s.tryAgain, onClick: onRetry ?? reload };
  const showHome = kind !== 'notFound' && kind !== 'session';

  return (
    <div
      lang={locale}
      dir={dir}
      role={kind === 'notFound' ? undefined : 'alert'}
      className={`${inline ? '' : 'min-h-[60vh] flex items-center justify-center px-4'}`}
      data-testid="friendly-error"
      data-kind={kind}
    >
      <div className="max-w-lg w-full bg-surface border border-border rounded-lg p-8 text-center">
        <h1 className="text-2xl font-bold text-fg mb-3">{copy.title}</h1>
        <p className="text-fg-muted mb-6">{copy.body}</p>
        <div className="flex flex-wrap justify-center gap-3 mb-6">
          {primary.href ? (
            <a href={primary.href} className={primaryButtonClass} data-testid="friendly-error-action">
              {primary.label}
            </a>
          ) : (
            <button type="button" onClick={primary.onClick} className={primaryButtonClass} data-testid="friendly-error-action">
              {primary.label}
            </button>
          )}
          {showHome && (
            <a href="/dashboard" className={secondaryButtonClass}>
              {home}
            </a>
          )}
        </div>
        {reference && <ReferenceBox reference={reference} label={s.reference} hint={s.referenceHint} copyLabel={s.copy} copiedLabel={s.copied} />}
      </div>
    </div>
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
    <div className="border-t border-border pt-4">
      <p className="text-sm text-fg-muted mb-2">{hint}</p>
      <div className="inline-flex items-center gap-3 bg-surface-2 border border-border rounded px-3 py-2">
        <span className="text-sm text-fg-muted">{label}</span>
        <code className="font-mono font-semibold text-fg" dir="ltr" data-testid="friendly-error-ref">
          {reference}
        </code>
        <button
          type="button"
          onClick={copyRef}
          className="text-sm text-link hover:text-link-hover underline-offset-2 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          data-testid="friendly-error-copy"
        >
          <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
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
