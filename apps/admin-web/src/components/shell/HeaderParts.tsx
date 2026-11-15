/**
 * The shared header's pieces as React elements (docs/design/NAV.md "Header"): the same elements,
 * classes, text and ARIA as packages/fanous-tokens/nav/header.js builds, styled by aun-nav.css.
 * test/header-parts.test.ts renders each one and compares it with the builder's output, so the
 * admin's header can never drift from the one every other app renders (the videos site has the
 * same pieces in apps/web Header/HeaderParts.tsx). App hooks (test ids, handlers) are the only additions.
 */
import type { MouseEventHandler, Ref } from 'react';
import { HEADER_LABELS, MENU_ICON_BODY, samePath } from '../../../../../packages/fanous-tokens/nav/header.js';
import { MODE_ICON_ATTRS, modeIconSvg, modeToggleLabel } from '../../../../../packages/fanous-tokens/nav/mode-toggle.js';

export type HeaderLang = 'en' | 'ar';
const labels = (lang: string) => HEADER_LABELS[lang === 'ar' ? 'ar' : 'en'];
const otherLang = (lang: string): HeaderLang => (lang === 'ar' ? 'en' : 'ar');

/** The logo lockup: the owner's logo (round), the wordmark and the app's name on a second line. */
export function HeaderBrand({
  lang,
  href,
  app,
  link,
}: {
  lang: string;
  href: string;
  app?: string;
  /** The app's link component (client navigation); a plain <a> by default. Typed loosely: next/link's
      props come from a second copy of React's types in this workspace. */
  link?: unknown;
}) {
  const L = (link ?? 'a') as 'a';
  return (
    <L className="aun-brand" href={href}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a 36px logo; next/image adds nothing here */}
      <img className="aun-brand-mark" src="/brand/logo-64.webp" alt="" width={36} height={36} />
      <span className="aun-brand-text">
        <span className="aun-brand-name">{labels(lang).siteName}</span>
        {app ? <span className="aun-brand-app">{app}</span> : null}
      </span>
    </L>
  );
}

/** "QA" / "STAGE" after the brand; nothing in production, previews or local dev. */
export function HeaderEnvBadge({ environment, lang }: { environment: string | undefined | null; lang: string }) {
  const env = String(environment ?? '').toLowerCase();
  if (env !== 'qa' && env !== 'stage') return null;
  const name = labels(lang).env[env];
  return (
    <span className="aun-env" role="note" aria-label={name} title={name}>
      {env.toUpperCase()}
    </span>
  );
}

/**
 * The language button's link: this page and its query (the admin keeps one URL in both languages; the
 * language is a cookie). The path goes through the shared samePath, so a request path such as
 * "//evil.example" can never become a protocol-relative link to another host.
 */
export function selfHref(pathname: string | null | undefined, search?: string) {
  const q = search ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `${samePath(pathname || '/')}${q === '?' ? '' : q}`;
}

/**
 * The language button: the other language's own name. `href` is the current page and query in
 * the other language; `onClick` keeps the app's own way of switching (no full reload).
 */
export function HeaderLangButton({ lang, href, onClick }: { lang: string; href: string; onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  const l = labels(lang);
  const to = otherLang(lang);
  return (
    <a className="aun-lang" href={href} hrefLang={to} onClick={onClick} data-testid="language-toggle">
      <span className="aun-visually-hidden">{l.switchLang}: </span>
      <span lang={to}>{l.otherLang}</span>
    </a>
  );
}

/** lucide `menu`, exactly as menuButtonHtml draws it. */
const MENU_ICON_SVG = `<svg ${MODE_ICON_ATTRS} class="lucide lucide-menu" aria-hidden="true" focusable="false">${MENU_ICON_BODY}</svg>`;

/**
 * The drawer's menu button, first in the bar: menuButtonHtml's 40px `.aun-icon-btn.aun-menu-btn` with
 * lucide `menu`, named "Menu" / "القائمة", the same button as the videos site's. A drawer is not a
 * popover, so it has no popovertarget and no aun-menu-collapse; globals.css hides it from 768px,
 * where the sidebar is always there.
 */
export function HeaderMenuButton({
  lang,
  className,
  ref,
  onClick,
  expanded,
  controls,
  testId,
}: {
  lang: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  expanded?: boolean;
  controls?: string;
  testId?: string;
}) {
  const name = labels(lang).menu;
  return (
    <button
      ref={ref}
      type="button"
      className={className ? `aun-icon-btn aun-menu-btn ${className}` : 'aun-icon-btn aun-menu-btn'}
      aria-label={name}
      title={name}
      aria-expanded={expanded}
      aria-controls={controls}
      data-testid={testId}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: MENU_ICON_SVG }}
    />
  );
}

/**
 * Light / dark: the sun in dark mode, the moon in light, named for the mode it switches to. Both icons
 * are in the button and CSS shows the one for the mode on screen (globals.css .mode-sun/.mode-moon), so
 * it is right at first paint, before the browser knows the device's mode.
 */
export function HeaderModeButton({ lang, dark, onClick }: { lang: string; dark: boolean; onClick?: MouseEventHandler<HTMLButtonElement> }) {
  const label = modeToggleLabel(lang === 'ar' ? 'ar' : 'en', dark);
  return (
    <button
      type="button"
      className="aun-icon-btn aun-mode"
      id="mode-toggle"
      data-testid="theme-toggle"
      aria-label={label}
      title={label}
      onClick={onClick}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: modeIconSvg('moon', 'mode-icon mode-moon') + modeIconSvg('sun', 'mode-icon mode-sun') }}
    />
  );
}

/** "Sign in" when signed out (the admin's public pages): the solid pill, to /login. */
export function HeaderSignIn({ lang, href }: { lang: string; href: string }) {
  return (
    <a className="aun-signin" href={href} data-testid="header-sign-in">
      {labels(lang).signIn}
    </a>
  );
}
