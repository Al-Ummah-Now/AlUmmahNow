/** The site-wide theme, chosen by an admin. Light and dark stay per viewer. */
export const SITE_THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];
export const DEFAULT_SITE_THEME: SiteTheme = 'fawanees';
export const SITE_THEME_SETTING_KEY = 'site.theme';

/** Any stored or received value, reduced to a built-in theme that exists. */
export function resolveSiteTheme(value: unknown): SiteTheme {
  return (SITE_THEMES as readonly unknown[]).includes(value) ? (value as SiteTheme) : DEFAULT_SITE_THEME;
}

export const isBuiltInSiteTheme = (value: unknown): value is SiteTheme => (SITE_THEMES as readonly unknown[]).includes(value);

/**
 * The active theme: a built-in id, or a published theme package made in the admin, stored as
 * `<id>@<version>` (docs/themes/README.md).
 */
export type SiteThemeRef = { id: SiteTheme; version: null } | { id: string; version: string };

const PACKAGE_REF = /^([a-z][a-z0-9-]{1,39})@((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/;

/** A stored setting value as a theme reference; anything unknown is the default built-in. */
export function parseSiteThemeValue(value: unknown): SiteThemeRef {
  if (isBuiltInSiteTheme(value)) return { id: value, version: null };
  const m = typeof value === 'string' ? PACKAGE_REF.exec(value) : null;
  if (m && !isBuiltInSiteTheme(m[1])) return { id: m[1], version: m[2] };
  return { id: DEFAULT_SITE_THEME, version: null };
}

export const siteThemeValue = (ref: SiteThemeRef) => (ref.version ? `${ref.id}@${ref.version}` : ref.id);

/** What GET /public/site-theme answers. `theme` is the id the page's data-theme uses. */
export interface PublicSiteTheme {
  theme: string;
  /** Present for a theme package made in the admin: where its compiled CSS is, on the admin API. */
  package?: { id: string; version: string; css: string };
}
