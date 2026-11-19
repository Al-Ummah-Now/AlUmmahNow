'use client';

// The error-page family's card (vendored as is by www, sites, Auth and the CMS)
import '../../../../../packages/fanous-tokens/errors/aun-error-page.css';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ERROR_KIND_STATUS,
  ERROR_PAGE_ICONS,
  errorCodeLabel,
  errorKindIcon,
  errorScreenStrings,
  type ErrorPageIcon,
  type FriendlyErrorKind,
} from '@al-ummah/shared-types';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';

/**
 * The error card every error screen on the site uses (404, 410, 500, a crashed page, sign-in failed):
 * one frosted-glass card on the lantern street, inside the site's header and rail. The same card,
 * words and actions as admin, www, scholar sites, Auth and the CMS (wiki guides/error-pages.md).
 * Theme tokens and materials only; no animation; en/ar with RTL; never a stack or raw message.
 */
export interface ErrorAction {
  label: string;
  icon?: ErrorPageIcon;
  href?: string;
  onClick?: () => void;
  testId?: string;
  /** A form submit button instead (the sign-in retry is a server action) */
  form?: (button: ReactNode) => ReactNode;
}

interface Head {
  kind: FriendlyErrorKind;
  title: string;
  body: string;
}

export interface ErrorScreenProps {
  locale: string;
  kind: FriendlyErrorKind;
  /** Overrides the shared words (sign-in failed has its own) */
  title?: string;
  body?: string;
  /**
   * Another screen the same HTML can turn into: a 404 the Worker answers as 410 Gone (lib/seo/gone.ts)
   * swaps data-error-status, and CSS shows the matching heading block.
   */
  alternate?: FriendlyErrorKind;
  /** The site search (404 and 410) */
  search?: boolean;
  primary: ErrorAction;
  secondary?: ErrorAction[];
  /** Go back (history), shown when there is somewhere to go back to */
  back?: boolean;
  reference?: string;
  /** "Still stuck? Contact us" */
  contactHref?: string;
  /** alert for crashes; a plain page for 404/410 */
  role?: 'alert';
  testId?: string;
  dataKind?: string;
}

export function ErrorIcon({ name }: { name: ErrorPageIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      dangerouslySetInnerHTML={{ __html: ERROR_PAGE_ICONS[name] }}
    />
  );
}

function HeadBlock({ head, locale, hidden }: { head: Head; locale: string; hidden?: boolean }) {
  const status = ERROR_KIND_STATUS[head.kind];
  return (
    // The Worker may swap `hidden` between the 404 and 410 blocks before hydration (lib/seo/gone.ts)
    <div className="ep-head" data-when={status ?? 'any'} hidden={hidden || undefined} suppressHydrationWarning>
      <span className="ep-badge" aria-hidden="true">
        <ErrorIcon name={errorKindIcon(head.kind)} />
      </span>
      <div className="ep-heading">
        {status ? <p className="ep-code">{errorCodeLabel(locale, status)}</p> : null}
        <h1 className="ep-title" id={`ep-title-${status ?? head.kind}`}>{head.title}</h1>
      </div>
      <p className="ep-body">{head.body}</p>
    </div>
  );
}

function ActionButton({ action, variant }: { action: ErrorAction; variant: 'primary' | 'secondary' }) {
  const cls = `b ${variant === 'primary' ? 'b-primary' : 'b-secondary'} ep-btn`;
  const inner = (
    <>
      {action.icon ? <ErrorIcon name={action.icon} /> : null}
      <span>{action.label}</span>
    </>
  );
  if (action.form) {
    return <>{action.form(<button type="submit" className={cls} data-testid={action.testId}>{inner}</button>)}</>;
  }
  if (action.href) {
    return <a href={action.href} className={cls} data-testid={action.testId}>{inner}</a>;
  }
  return <button type="button" onClick={action.onClick} className={cls} data-testid={action.testId}>{inner}</button>;
}

export function ErrorScreen(props: ErrorScreenProps) {
  const { locale, kind, alternate, search, primary, secondary = [], back, reference, contactHref, role, testId = 'error-screen', dataKind } = props;
  const s = errorScreenStrings(locale);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const head: Head = { kind, title: props.title ?? s.kinds[kind].title, body: props.body ?? s.kinds[kind].body };
  const status = ERROR_KIND_STATUS[kind];
  const [copied, setCopied] = useState(false);
  // After mount only (the server can't know the history): no hydration mismatch
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => setCanGoBack(!!back && window.history.length > 1), [back]);

  const onCopy = async () => {
    if (!reference) return;
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
      id={MAIN_CONTENT_ID}
      className="ep"
      dir={dir}
      lang={locale}
      role={role}
      aria-live={role ? 'assertive' : undefined}
      aria-labelledby={role ? `ep-title-${status ?? kind}` : undefined}
      data-testid={testId}
      data-kind={dataKind ?? kind}
      data-error-status={status}
      // The Worker may answer this 404 as 410 (lib/seo/gone.ts) and swap the attribute before hydration
      suppressHydrationWarning
    >
      <section className="ep-card" aria-labelledby={`ep-title-${status ?? kind}`}>
        <HeadBlock head={head} locale={locale} />
        {alternate ? <HeadBlock head={{ kind: alternate, title: s.kinds[alternate].title, body: s.kinds[alternate].body }} locale={locale} hidden /> : null}

        {search ? (
          <form className="ep-search" role="search" action={`/${locale}/search`} method="get">
            <label className="ep-sr" htmlFor="ep-search-q">{s.searchLabel}</label>
            <input id="ep-search-q" className="ep-search-input" type="search" name="q" placeholder={s.searchPlaceholder} autoComplete="off" enterKeyHint="search" />
            <button type="submit" className="b b-secondary ep-btn ep-search-btn" data-testid="error-search">
              <ErrorIcon name="search" />
              <span>{s.search}</span>
            </button>
          </form>
        ) : null}

        {reference ? (
          <div className="ep-ref" data-testid="friendly-error-reference">
            <div className="ep-ref-row">
              <span className="ep-ref-label">{s.reference}</span>
              <code dir="ltr" className="ep-ref-code" data-testid="error-reference">{reference}</code>
              <button type="button" onClick={onCopy} className="ep-ref-copy">
                <ErrorIcon name="copy" />
                <span aria-live="polite">{copied ? s.copied : s.copy}</span>
              </button>
            </div>
            <p className="ep-ref-hint">{s.referenceHint}</p>
          </div>
        ) : null}

        <footer className="ep-foot">
          {contactHref ? (
            <p className="ep-help">
              {s.needHelp} <a href={contactHref}>{s.contactUs}</a>
            </p>
          ) : null}
          <div className="ep-actions">
            {canGoBack ? <ActionButton action={{ label: s.goBack, icon: 'back', onClick: () => window.history.back(), testId: 'error-back' }} variant="secondary" /> : null}
            {secondary.map((a) => <ActionButton key={a.label} action={a} variant="secondary" />)}
            <ActionButton action={primary} variant="primary" />
          </div>
        </footer>
      </section>
    </main>
  );
}
