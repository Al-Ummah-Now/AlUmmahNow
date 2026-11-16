/**
 * One-line truncation without an ellipsis (#1382): WebKit's web process aborts on
 * text-overflow: ellipsis (with bidi isolation, which every page has through <html dir>).
 * globals.css clips all text; boxes listed here get data-cut when their text overflows, and
 * those fade toward their end edge.
 */

/** Every one-line truncation box: Tailwind's `truncate` and the CSS classes that truncate. */
export const CUT_SELECTOR = [
  '.truncate',
  // theme/system.css, theme/contact.css
  '.nv span', '.related-videos .rv-sub', '.tsf-value', '.watch-channel-name', '.ct-page-url',
  // styles/player-skin.css
  '.vjs-fanous-tip-chapter', '.vjs-fanous-mi-label', '.vjs-fanous-mi-value', '.vjs-fanous-next-channel', '.vjs-fanous-live-label',
  // packages/fanous-tokens/nav/aun-nav.css (header and menus)
  '.aun-acct-name', '.aun-brand-name', '.aun-menu-who-name', '.aun-email-local', '.aun-email-domain', '.aun-acct-current', '.aun-menu-text', '.aun-acct-label',
].join(', ');

/** Sets data-cut while the element's text is wider than its box. */
export function markCut(el: Element): void {
  const cut = el.scrollWidth > el.clientWidth + 1;
  if (cut !== el.hasAttribute('data-cut')) el.toggleAttribute('data-cut', cut);
}
