/**
 * Server-rendered HTML for the public page and an incident page. No framework,
 * no client data fetching: one cached HTML response plus two static files
 * (/status.css, /mode.js). Text is escaped here; incident text is plain text
 * (line breaks kept), never HTML.
 */
import type { ComponentState, IncidentStatus } from '@al-ummah/shared-types';
import { componentName, formatDay, formatPercent, formatTime, stateLabel, t, type Locale } from './i18n';
import type { ComponentSummary, StatusSummary } from './model';
import type { Incident } from './store';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Plain text with paragraphs and line breaks. */
function text(s: string): string {
  return s
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const ICONS: Record<ComponentState, string> = {
  operational: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  maintenance: '<path d="M22.7 19 13.6 9.9c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>',
  degraded: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/>',
  partial: '<path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/>',
  major: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 13.6L15.6 17 12 13.4 8.4 17 7 15.6 10.6 12 7 8.4 8.4 7 12 10.6 15.6 7 17 8.4 13.4 12z"/>',
};

function icon(state: ComponentState, cls = 'icon'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[state]}</svg>`;
}

function pill(locale: Locale, state: ComponentState): string {
  return `<span class="pill s-${state}">${icon(state)}<span>${esc(stateLabel(locale, state))}</span></span>`;
}

export interface PageOptions {
  locale: Locale;
  /** Path without the locale prefix ('' or /incidents/<id>) */
  path: string;
  assetVersion: string;
  environment: string;
}

const prefix = (locale: Locale) => (locale === 'ar' ? '/ar' : '');

function shell(o: PageOptions, title: string, main: string): string {
  const { locale } = o;
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const otherHref = `${prefix(other)}${o.path}` || '/';
  const self = `${prefix(locale)}${o.path}` || '/';
  const envTag = o.environment === 'production' ? '' : `<span class="env">${esc(o.environment.toUpperCase())}</span>`;
  return `<!doctype html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(t(locale, 'description'))}">
<meta name="color-scheme" content="light dark">
<script src="/mode.js?v=${esc(o.assetVersion)}"></script>
<link rel="stylesheet" href="/status.css?v=${esc(o.assetVersion)}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="canonical" href="${esc(self)}">
<link rel="alternate" hreflang="en" href="${esc(o.path || '/')}">
<link rel="alternate" hreflang="ar" href="/ar${esc(o.path)}">
<link rel="alternate" type="application/atom+xml" title="${esc(t(locale, 'atom'))}" href="${prefix(locale)}/feed.atom">
<link rel="alternate" type="application/rss+xml" title="${esc(t(locale, 'rss'))}" href="${prefix(locale)}/feed.rss">
</head>
<body>
<a class="skip" href="#main">${esc(t(locale, 'skip'))}</a>
<header class="top">
  <div class="wrap top-row">
    <a class="brand" href="${prefix(locale) || '/'}"><img src="/apple-touch-icon.png" alt="" width="32" height="32"><span>${esc(t(locale, 'siteName'))}</span><span class="brand-sub">${esc(t(locale, 'title'))}</span>${envTag}</a>
    <div class="tools">
      <a class="tool" href="${esc(otherHref)}" hreflang="${other}" lang="${other}" aria-label="${esc(t(locale, 'otherLanguageLabel'))}">${esc(t(locale, 'otherLanguage'))}</a>
      <button class="tool" type="button" id="mode-toggle" aria-pressed="false" hidden>${esc(t(locale, 'darkMode'))}</button>
    </div>
  </div>
</header>
<main id="main" class="wrap">
${main}
</main>
<footer class="wrap foot">
  <p>${esc(t(locale, 'footerNote'))}</p>
  <p class="feeds"><span>${esc(t(locale, 'feeds'))}:</span> <a href="${prefix(locale)}/feed.atom">${esc(t(locale, 'atom'))}</a> <a href="${prefix(locale)}/feed.rss">${esc(t(locale, 'rss'))}</a> <a href="/api/status.json">${esc(t(locale, 'json'))}</a></p>
</footer>
</body>
</html>`;
}

function bars(locale: Locale, c: ComponentSummary): string {
  const label = c.uptime90 === null ? t(locale, 'uptimeNone') : t(locale, 'uptimeValue', { value: formatPercent(locale, c.uptime90) });
  const items = c.days
    .map((d, i) => {
      const day = formatDay(locale, d.day);
      const tip =
        d.level === 'none'
          ? t(locale, 'dayNoData', { day })
          : d.uptime === null
            ? t(locale, 'dayState', { day, state: stateLabel(locale, d.level) })
            : t(locale, 'dayUptime', { day, state: stateLabel(locale, d.level), value: formatPercent(locale, d.uptime) });
      return `<span class="bar b-${d.level}${i < c.days.length - 30 ? ' old' : ''}" title="${esc(tip)}"></span>`;
    })
    .join('');
  return `<div class="bars" role="img" aria-label="${esc(`${t(locale, 'uptimeTitle')}: ${label}`)}">${items}</div>
  <div class="bar-legend" aria-hidden="true"><span><span class="ago90">${esc(t(locale, 'daysAgo'))}</span><span class="ago30">${esc(t(locale, 'daysAgo30'))}</span></span><span class="uptime">${esc(label)}</span><span>${esc(t(locale, 'today'))}</span></div>`;
}

function incidentCard(locale: Locale, i: Incident, opts: { full?: boolean } = {}): string {
  const title = locale === 'ar' ? i.title_ar : i.title_en;
  const affected = i.components.length ? `<p class="meta">${esc(t(locale, 'affected', { list: i.components.map((c) => componentName(locale, c)).join(locale === 'ar' ? '، ' : ', ') }))}</p>` : '';
  const when =
    i.kind === 'maintenance'
      ? `<p class="meta">${esc(i.ends_at ? t(locale, 'window', { from: formatTime(locale, i.starts_at), to: formatTime(locale, i.ends_at) }) : t(locale, 'from', { from: formatTime(locale, i.starts_at) }))}</p>`
      : '';
  const updates = (opts.full ? i.updates : i.updates.slice(0, 1))
    .map(
      (u) => `<li class="update"><p class="u-head"><strong>${esc(stateLabel(locale, u.status as IncidentStatus))}</strong> <time datetime="${esc(u.created_at)}">${esc(formatTime(locale, u.created_at))}</time></p>${text(locale === 'ar' ? u.body_ar : u.body_en)}</li>`,
    )
    .join('');
  const level: ComponentState = i.kind === 'maintenance' ? 'maintenance' : i.impact === 'none' ? 'degraded' : i.impact === 'maintenance' ? 'maintenance' : i.impact;
  const head = opts.full ? `<h1 class="inc-title">${esc(title)}</h1>` : `<h3 class="inc-title"><a href="${prefix(locale)}/incidents/${encodeURIComponent(i.id)}">${esc(title)}</a></h3>`;
  return `<article class="incident i-${level}">
  ${head}
  <p class="inc-status">${i.status === 'scheduled' ? '' : `${pill(locale, level)} `}<span class="tag">${esc(stateLabel(locale, i.status))}</span></p>
  ${when}${affected}
  <ol class="updates">${updates}</ol>
</article>`;
}

export function renderStatusPage(s: StatusSummary, o: PageOptions): string {
  const { locale } = o;
  const overallKey = `overall_${s.overall}` as const;
  const banner = `<section class="banner s-${s.overall}" aria-live="polite">
  ${icon(s.overall, 'icon big')}
  <div><h1>${esc(t(locale, overallKey))}</h1>
  <p>${s.lastCheckedAt ? esc(t(locale, 'lastChecked', { time: formatTime(locale, s.lastCheckedAt) })) : esc(t(locale, 'noData'))}</p></div>
</section>`;
  const activeIncidents = s.active.filter((i) => i.kind === 'incident');
  const activeMaint = s.active.filter((i) => i.kind === 'maintenance');
  const section = (id: string, title: string, list: Incident[]) =>
    list.length ? `<section aria-labelledby="${id}"><h2 id="${id}">${esc(title)}</h2>${list.map((i) => incidentCard(locale, i)).join('')}</section>` : '';
  const components = `<section aria-labelledby="components-title" class="card">
  <h2 id="components-title">${esc(t(locale, 'components'))}</h2>
  <p class="sub">${esc(t(locale, 'uptimeTitle'))}</p>
  <ul class="components">
  ${s.components
    .map(
      (c) => `<li class="component" data-component="${c.id}" data-state="${c.state}">
    <div class="c-row"><h3>${esc(componentName(locale, c.id))}</h3>${pill(locale, c.state)}</div>
    ${bars(locale, c)}
  </li>`,
    )
    .join('')}
  </ul>
</section>`;
  const history = `<section aria-labelledby="history-title"><h2 id="history-title">${esc(t(locale, 'history'))}</h2>${
    s.history.length ? s.history.map((i) => incidentCard(locale, i)).join('') : `<p class="empty">${esc(t(locale, 'historyNone'))}</p>`
  }</section>`;
  const main = [
    banner,
    section('active-title', t(locale, 'active'), activeIncidents),
    section('maint-title', t(locale, 'maintenanceNow'), activeMaint),
    section('upcoming-title', t(locale, 'upcoming'), s.upcoming),
    components,
    history,
  ].join('\n');
  return shell(o, t(locale, 'pageTitle'), main);
}

export function renderIncidentPage(i: Incident | null, o: PageOptions): string {
  const { locale } = o;
  const back = `<p class="back"><a href="${prefix(locale) || '/'}">${esc(t(locale, 'back'))}</a></p>`;
  if (!i) return shell(o, t(locale, 'notFound'), `${back}<section class="card"><h1>${esc(t(locale, 'notFound'))}</h1><p>${esc(t(locale, 'notFoundBody'))}</p></section>`);
  const title = locale === 'ar' ? i.title_ar : i.title_en;
  return shell(o, `${title} · ${t(locale, 'pageTitle')}`, `${back}${incidentCard(locale, i, { full: true })}`);
}
