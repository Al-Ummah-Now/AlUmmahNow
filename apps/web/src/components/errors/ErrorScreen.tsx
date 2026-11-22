'use client';

// The error-page family's card (vendored as is by www, sites, Auth and the CMS)
import '../../../../../packages/fanous-tokens/errors/aun-error-page.css';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ERROR_KIND_STATUS,
  ERROR_PAGE_ICONS,
  errorCodeLabel,
  errorKindIcon,
  errorPageTitle,
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
   * rewrites the card's words and status, and the card renders that screen once hydrated.
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

export function ErrorIcon({ name, swappable }: { name: ErrorPageIcon; swappable?: boolean }) {
  return (
    <svg
      // The Worker may redraw the badge for a 410 before hydration (lib/seo/gone.ts)
      suppressHydrationWarning={swappable || undefined}
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

/**
 * The badge, code line, title and words. One block and one h1: for a 404 the Worker answers as 410
 * (lib/seo/gone.ts) it rewrites the text, the badge and the status before hydration, and the card
 * then renders the 410 screen itself (`swapped`), so only text differs while hydrating.
 */
function HeadBlock({ head, locale }: { head: Head; locale: string }) {
  const status = ERROR_KIND_STATUS[head.kind];
  return (
    <div className="ep-head" data-when={status ?? 'any'} suppressHydrationWarning>
      <span className="ep-badge" aria-hidden="true">
        <ErrorIcon name={errorKindIcon(head.kind)} swappable />
      </span>
      <div className="ep-heading">
        {status ? <p className="ep-code" suppressHydrationWarning>{errorCodeLabel(locale, status)}</p> : null}
        <h1 className="ep-title" id={`ep-title-${status ?? head.kind}`} suppressHydrationWarning>{head.title}</h1>
      </div>
      <p className="ep-body" suppressHydrationWarning>{head.body}</p>
    </div>
  );
}

function ActionButton({ action, variant }: { action: ErrorAction; variant: 'primary' | 'secondary' }) {
  // The family's own buttons (aun-error-page.css), never the site's: the same on every app
  const cls = `ep-btn ${variant === 'primary' ? 'ep-btn-primary' : 'ep-btn-secondary'}`;
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

const noSubscribe = () => () => undefined;

/** This document's HTTP status, when the Worker set it (lib/seo/gone.ts: a purged item's 404 → 410). */
function documentStatus(): number | undefined {
  const value = (window as unknown as Record<string, unknown>).__aunHttpStatus;
  return typeof value === 'number' ? value : undefined;
}

export function ErrorScreen(props: ErrorScreenProps) {
  const { locale, kind: baseKind, alternate, search, primary, secondary = [], back, reference, contactHref, role, testId = 'error-screen', dataKind } = props;
  const s = errorScreenStrings(locale);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  // The alternate screen when the Worker answered with its status (410 for a purged item); the server
  // render and hydration use the base screen, so nothing mismatches
  const altStatus = alternate ? ERROR_KIND_STATUS[alternate] : undefined;
  const swapped = useSyncExternalStore(noSubscribe, () => altStatus !== undefined && documentStatus() === altStatus, () => false);
  const kind = swapped && alternate ? alternate : baseKind;
  const head: Head = swapped ? { kind, title: s.kinds[kind].title, body: s.kinds[kind].body } : { kind, title: props.title ?? s.kinds[kind].title, body: props.body ?? s.kinds[kind].body };
  const status = ERROR_KIND_STATUS[kind];
  // The tab says what happened, in the family's one format ("Page not found | Al Ummah Now"), whatever
  // route the error happened on
  useEffect(() => {
    document.title = errorPageTitle(locale, head.title);
  }, [locale, head.title]);
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

        {search ? (
          <form className="ep-search" role="search" action={`/${locale}/search`} method="get">
            <label className="ep-sr" htmlFor="ep-search-q">{s.searchLabel}</label>
            <input id="ep-search-q" className="ep-search-input" type="search" name="q" placeholder={s.searchPlaceholder} autoComplete="off" enterKeyHint="search" />
            <button type="submit" className="ep-btn ep-btn-secondary ep-search-btn" data-testid="error-search">
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
