/** Atom and RSS feeds of incidents and maintenance (one entry per incident, newest update first). */
import { componentName, stateLabel, t, type Locale } from './i18n';
import { esc } from './render';
import type { Incident } from './store';

function entryText(locale: Locale, i: Incident): string {
  const affected = i.components.map((c) => componentName(locale, c)).join(locale === 'ar' ? '، ' : ', ');
  const updates = i.updates.map((u) => `${stateLabel(locale, u.status)} (${u.created_at}): ${locale === 'ar' ? u.body_ar : u.body_en}`).join('\n\n');
  return [affected ? t(locale, 'affected', { list: affected }) : '', updates].filter(Boolean).join('\n\n');
}

const title = (locale: Locale, i: Incident) => `${locale === 'ar' ? i.title_ar : i.title_en} (${stateLabel(locale, i.status)})`;

export function atomFeed(locale: Locale, base: string, incidents: Incident[], now: Date): string {
  const p = locale === 'ar' ? '/ar' : '';
  const updated = incidents[0]?.updated_at ?? now.toISOString();
  const entries = incidents
    .map(
      (i) => `<entry>
<id>${esc(`${base}/incidents/${i.id}`)}</id>
<title>${esc(title(locale, i))}</title>
<link rel="alternate" href="${esc(`${base}${p}/incidents/${encodeURIComponent(i.id)}`)}"/>
<published>${esc(i.created_at)}</published>
<updated>${esc(i.updated_at)}</updated>
<content type="text">${esc(entryText(locale, i))}</content>
</entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${locale}">
<id>${esc(`${base}${p}/feed.atom`)}</id>
<title>${esc(t(locale, 'pageTitle'))}</title>
<link rel="self" href="${esc(`${base}${p}/feed.atom`)}"/>
<link rel="alternate" href="${esc(`${base}${p}/`)}"/>
<updated>${esc(updated)}</updated>
${entries}
</feed>`;
}

export function rssFeed(locale: Locale, base: string, incidents: Incident[], now: Date): string {
  const p = locale === 'ar' ? '/ar' : '';
  const items = incidents
    .map(
      (i) => `<item>
<guid isPermaLink="false">${esc(`${i.id}:${i.updated_at}`)}</guid>
<title>${esc(title(locale, i))}</title>
<link>${esc(`${base}${p}/incidents/${encodeURIComponent(i.id)}`)}</link>
<pubDate>${new Date(i.updated_at).toUTCString()}</pubDate>
<description>${esc(entryText(locale, i))}</description>
</item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
<channel>
<title>${esc(t(locale, 'pageTitle'))}</title>
<link>${esc(`${base}${p}/`)}</link>
<description>${esc(t(locale, 'description'))}</description>
<language>${locale}</language>
<lastBuildDate>${now.toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
}
