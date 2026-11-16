/**
 * The locale for every Intl formatter in the admin (numbers, dates, relative times, plurals).
 *
 * Plain "ar" has no fixed digits: Node and Chromium format it with Latin digits, WebKit with
 * Arabic-Indic. A client component rendered on the server (Node) and hydrated in Safari then
 * disagreed on its text, React threw #418 and rendered the whole page again on the client (the
 * sidebar's Errors badge label, main red 2026-11-15). The admin shows Latin digits, so they are
 * pinned. Charts keep their own rule (chartLocale in @al-ummah/shared-types: Arabic-Indic, pinned).
 */
export function intlLocale(locale: string): string {
  return /^ar\b/.test(locale) && !locale.includes('-u-nu-') ? `${locale}-u-nu-latn` : locale;
}
