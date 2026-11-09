/** The site-wide theme, chosen by an admin. Light and dark stay per viewer. */
export const SITE_THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];
export const DEFAULT_SITE_THEME: SiteTheme = 'fawanees';
export const SITE_THEME_SETTING_KEY = 'site.theme';

/** Any stored or received value, reduced to a theme that exists. */
export function resolveSiteTheme(value: unknown): SiteTheme {
  return (SITE_THEMES as readonly unknown[]).includes(value) ? (value as SiteTheme) : DEFAULT_SITE_THEME;
}
