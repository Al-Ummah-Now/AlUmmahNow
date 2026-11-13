/**
 * The short link host's own pages: robots.txt and the "link not found" page. Everything else on the
 * host is a redirect. Nothing here is indexed: search engines index the real pages (canonical), and
 * the link previewers that honour robots.txt (X, LinkedIn, …) may still read a short link so its card
 * shows; they follow the redirect and read the real page's Open Graph tags.
 */

/** Previewers that check robots.txt before they build a card; search crawlers are refused. */
const PREVIEW_AGENTS = ['Twitterbot', 'LinkedInBot', 'Slackbot', 'Slackbot-LinkExpanding', 'TelegramBot', 'Discordbot', 'WhatsApp', 'facebookexternalhit', 'Pinterestbot'];

export function robotsTxt(): string {
  return [
    '# Short share links: each one redirects to its page on alummahnow.net, which is the one to index.',
    ...PREVIEW_AGENTS.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');
}

const STRINGS = {
  en: {
    title: 'Link not found',
    body: 'This link does not lead anywhere. The page may have been removed or made private, or the link may be mistyped.',
    home: 'Go to Al Ummah Now',
  },
  ar: {
    title: 'الرابط غير موجود',
    body: 'هذا الرابط لا يؤدي إلى أي صفحة. ربما حُذفت الصفحة أو صارت خاصة، أو أن في الرابط خطأ.',
    home: 'الذهاب إلى الأمة الآن',
  },
} as const;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The 404 page, in the link's ?lang= (Arabic) or English, with both texts so either reader understands it. */
export function notFoundPage(lang: 'en' | 'ar' | null, homeUrl: string): string {
  const primary = lang === 'ar' ? 'ar' : 'en';
  const secondary = primary === 'ar' ? 'en' : 'ar';
  const block = (l: 'en' | 'ar', heading: boolean) => {
    const s = STRINGS[l];
    const tag = heading ? 'h1' : 'h2';
    return `<section lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}"><${tag}>${escapeHtml(s.title)}</${tag}><p>${escapeHtml(s.body)}</p><p><a href="${escapeHtml(homeUrl)}${l === 'ar' ? '/ar/' : '/en/'}">${escapeHtml(s.home)}</a></p></section>`;
  };
  return `<!doctype html>
<html lang="${primary}" dir="${primary === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(STRINGS[primary].title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f4ee;--fg:#1d1b18;--muted:#5b554c;--link:#0b6b4f}
@media (prefers-color-scheme:dark){:root{--bg:#14120f;--fg:#f2ede4;--muted:#c4bcae;--link:#6fd3ad}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
main{max-width:34rem;padding:2rem 1rem}
section+section{margin-top:2rem;padding-top:1.5rem;border-top:1px solid color-mix(in srgb,var(--fg) 15%,transparent)}
h1,h2{margin:0 0 .5rem;font-size:1.4rem}
p{margin:.25rem 0;color:var(--muted)}
a{color:var(--link);font-weight:600}
</style>
</head>
<body><main data-testid="short-link-not-found">${block(primary, true)}${block(secondary, false)}</main></body>
</html>`;
}
