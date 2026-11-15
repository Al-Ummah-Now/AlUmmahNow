/**
 * The shared header's pieces as React elements (docs/design/NAV.md "Header"): the same elements,
 * classes, text and ARIA as packages/fanous-tokens/nav/header.js builds, styled by aun-nav.css.
 * __tests__/HeaderParts.test.tsx renders each one and compares it with the builder's output, so
 * this header can never drift from the one every other app renders. App-only hooks (test ids,
 * the logo's eager-load attributes, event handlers) are the only additions.
 */
import type { ButtonHTMLAttributes, ElementType, ImgHTMLAttributes, MouseEventHandler } from 'react';
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
  link: L = 'a',
  img,
}: {
  lang: string;
  href: string;
  app?: string;
  /** The app's link component (client navigation); a plain <a> by default. */
  link?: ElementType;
  /** Extra attributes for the logo (eager load, srcset, test id). */
  img?: Omit<ImgHTMLAttributes<HTMLImageElement>, 'className' | 'src' | 'alt' | 'width' | 'height'> & { 'data-testid'?: string };
}) {
  return (
    <L className="aun-brand" href={href}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a 36px logo; next/image adds nothing here */}
      <img className="aun-brand-mark" src="/brand/logo-64.webp" alt="" width={36} height={36} {...img} />
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

/** Website and Videos (the public sites other than this one), each with its app icon. */
export function HeaderAppLinks({ lang, links }: { lang: string; links: { id: string; href: string }[] }) {
  const l = labels(lang);
  const items = links.filter((a) => a.href && (a.id === 'www' || a.id === 'videos')) as { id: 'www' | 'videos'; href: string }[];
  if (items.length === 0) return null;
  return (
    <nav className="aun-apps" aria-label={l.apps}>
      {items.map((a) => (
        <a key={a.id} className="aun-app" href={a.href} data-testid={`header-app-${a.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the shared 22px app icon */}
          <img className="aun-app-mark" src={`/aun-nav/icons/${a.id}.webp`} alt="" width={22} height={22} />
          <span className="aun-app-name">{l[a.id]}</span>
        </a>
      ))}
    </nav>
  );
}

/**
 * The current page and query in the other language: the locale prefix swapped. The result always
 * starts with "/<lang>", and the rest goes through the shared samePath, so a request path such as
 * "//evil.example" can never turn the language link into a protocol-relative link to another host.
 */
export function langSwitchHref(pathname: string, lang: string, query?: string) {
  const from = lang === 'ar' ? 'ar' : 'en';
  const to = otherLang(lang);
  const path = samePath(pathname || '/');
  const rest = path === `/${from}` || path.startsWith(`/${from}/`) ? path.slice(from.length + 1) : path;
  const tail = rest === '' || rest === '/' ? '' : samePath(rest);
  return `/${to}${tail}${query ? `?${query}` : ''}`;
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
 * lucide `menu`, named "Menu" / "القائمة" (`label` names it while the drawer is open). A drawer is
 * not a popover, so it has no popovertarget and no aun-menu-collapse; the app hides it with its own
 * class where the drawer is not used.
 */
export function HeaderMenuButton({
  lang,
  label,
  className,
  ...rest
}: { lang: string; label?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'dangerouslySetInnerHTML' | 'type'>) {
  const name = label ?? labels(lang).menu;
  return (
    <button
      type="button"
      className={className ? `aun-icon-btn aun-menu-btn ${className}` : 'aun-icon-btn aun-menu-btn'}
      aria-label={name}
      title={name}
      {...rest}
      dangerouslySetInnerHTML={{ __html: MENU_ICON_SVG }}
    />
  );
}

/** Light / dark: the sun in dark mode, the moon in light, named for the mode it switches to. */
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
      dangerouslySetInnerHTML={{ __html: modeIconSvg(dark ? 'sun' : 'moon') }}
    />
  );
}

/**
 * "Sign in" when signed out: the solid pill. Here it submits the app's sign-in action (a form
 * post that starts the OAuth flow), so it is a submit button with the builder's class and words.
 */
export function HeaderSignIn({ lang }: { lang: string }) {
  return (
    <button type="submit" className="aun-signin" data-testid="header-sign-in">
      {labels(lang).signIn}
    </button>
  );
}
