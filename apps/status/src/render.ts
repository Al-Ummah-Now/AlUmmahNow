/**
 * Server-rendered HTML for the public page and an incident page. No framework,
 * no client data fetching: one cached HTML response plus two static files
 * (/status.css, /mode.js). Text is escaped here; incident text is plain text
 * (line breaks kept), never HTML.
 */
import type { ComponentState, IncidentStatus } from '@al-ummah/shared-types';
// The shared header (docs/design/NAV.md "Header"): the same builders and classes as every app
import { brandHtml, envBadgeHtml, langButtonHtml, modeButtonHtml, samePath } from '../../../packages/fanous-tokens/nav/header.js';
import { modeIconSvg, modeToggleLabel } from '../../../packages/fanous-tokens/nav/mode-toggle.js';
import { host, type StatusEnvName } from './checks';
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
  /** The request's query ("?…" or ''), kept by the language button (confirm and unsubscribe pages pass only their token) */
  search?: string;
  assetVersion: string;
  environment: string;
  /**
   * Email updates are offered (the notify queue is bound). Off, no footer link, no call to
   * action and no /subscribe page (wiki "Product rules → Hidden when off").
   */
  subscribe?: boolean;
}

const prefix = (locale: Locale) => (locale === 'ar' ? '/ar' : '');

/** The environment whose sites the header links to; anything unknown (local dev) is QA, like its checks. */
function linkEnv(environment: string): StatusEnvName {
  return environment === 'production' || environment === 'stage' ? environment : 'qa';
}

/**
 * The way back to the rest of Al Ummah Now, on this environment's own hosts: www and the videos
 * site in the page language, as the account menu's "Al Ummah Now apps" links them
 * (packages/shared-types app-links.ts: www `/<lang>/`, videos `/<lang>`).
 */
export function siteLinks(locale: Locale, environment: string): { www: string; videos: string } {
  const env = linkEnv(environment);
  return { www: `${host(env, 'www')}/${locale}/`, videos: `${host(env, 'videos')}/${locale}` };
}

/** The other sites' names, as the account menus' "Al Ummah Now apps" call them. */
const SITE_NAMES = {
  en: { apps: 'Al Ummah Now apps', www: 'Website', videos: 'Videos' },
  ar: { apps: 'تطبيقات الأمة الآن', www: 'الموقع', videos: 'المرئيات' },
} as const;

/**
 * The way back to the other sites. The header has no links to other sites (owner, 2026-11-15;
 * docs/design/NAV.md) and this page has no drawer or account menu, so the footer carries them at
 * every width: the app icons and names, as plain page links.
 */
function footApps(locale: Locale, apps: { id: 'www' | 'videos'; href: string }[]): string {
  const l = SITE_NAMES[locale];
  const items = apps
    .map((a) => `<a href="${esc(a.href)}"><img src="/aun-nav/icons/${a.id}.webp" alt="" width="20" height="20">${esc(l[a.id])}</a>`)
    .join(' ');
  return `<nav class="foot-apps" aria-label="${esc(l.apps)}">${items}</nav>`;
}

/**
 * Light / Dark: the shared button (header.js modeButtonHtml) with both icons, as the page is cached
 * and the mode is chosen on the device: CSS shows the moon in light and the sun in dark, and mode.js
 * names it for the mode it switches to (data-label-*) and shows it (it needs JS, so it starts hidden).
 */
export function modeToggle(locale: Locale): string {
  const toDark = modeToggleLabel(locale, false);
  const toLight = modeToggleLabel(locale, true);
  return modeButtonHtml({ lang: locale, dark: false })
    .replace(' aria-label=', ` data-label-dark="${esc(toDark)}" data-label-light="${esc(toLight)}" hidden aria-label=`)
    .replace('</button>', `${modeIconSvg('sun')}</button>`);
}

function shell(o: PageOptions, title: string, main: string): string {
  const { locale } = o;
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const query = o.search && o.search !== '?' ? o.search : '';
  // the same page and query in the other language; samePath keeps it on this host whatever the path
  const otherHref = samePath(`${prefix(other)}${o.path}` || '/') + query;
  const self = `${prefix(locale)}${o.path}` || '/';
  const sites = siteLinks(locale, o.environment);
  const apps = [{ id: 'www' as const, href: sites.www }, { id: 'videos' as const, href: sites.videos }];
  return `<!doctype html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(t(locale, 'description'))}">
<meta name="color-scheme" content="light dark">
<script src="/mode.js?v=${esc(o.assetVersion)}"></script>
<link rel="stylesheet" href="/fanous/tokens.css?v=${esc(o.assetVersion)}">
<link rel="stylesheet" href="/aun-nav/aun-nav.css?v=${esc(o.assetVersion)}">
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
<header class="aun-header">
  <div class="aun-header-row">
    ${brandHtml({ lang: locale, href: prefix(locale) || '/', app: t(locale, 'title') })}
    ${envBadgeHtml(o.environment, locale)}
    <div class="aun-header-primary"></div>
    <div class="aun-header-tools">
      ${langButtonHtml({ lang: locale, href: otherHref })}
      ${modeToggle(locale)}
    </div>
  </div>
</header>
<main id="main" class="wrap">
${main}
</main>
<footer class="wrap foot">
  ${footApps(locale, apps)}
  <p>${esc(t(locale, 'footerNote'))}</p>
  <p class="feeds"><span>${esc(t(locale, 'feeds'))}:</span> ${o.subscribe ? `<a href="${prefix(locale)}/subscribe" data-testid="footer-subscribe">${esc(t(locale, 'emailUpdates'))}</a> ` : ''}<a href="${prefix(locale)}/feed.atom">${esc(t(locale, 'atom'))}</a> <a href="${prefix(locale)}/feed.rss">${esc(t(locale, 'rss'))}</a> <a href="/api/status.json">${esc(t(locale, 'json'))}</a></p>
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
    o.subscribe ? subscribeCta(locale) : '',
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

const MAIL_ICON = '<svg class="icon big" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4.2-8 5-8-5V6l8 5 8-5z"/></svg>';

function subscribeCta(locale: Locale): string {
  return `<section class="card cta" aria-labelledby="cta-title" data-testid="subscribe-cta">
  ${MAIL_ICON}
  <div class="cta-text"><h2 id="cta-title">${esc(t(locale, 'ctaTitle'))}</h2><p>${esc(t(locale, 'ctaBody'))}</p></div>
  <a class="button" href="${prefix(locale)}/subscribe">${esc(t(locale, 'ctaButton'))}</a>
</section>`;
}

export type SubscribeError = 'invalid' | 'limited' | 'unavailable';
const ERROR_KEY = { invalid: 'subscribeInvalid', limited: 'subscribeLimited', unavailable: 'subscribeUnavailable' } as const;

/** A centred panel for the subscription pages: icon, heading, text, then the action. */
function panel(locale: Locale, opts: { title: string; body: string[]; action?: string; tone?: 'ok' | 'info'; testId: string }): string {
  const back = `<p class="back"><a href="${prefix(locale) || '/'}">${esc(t(locale, 'back'))}</a></p>`;
  const toneIcon = opts.tone === 'ok' ? icon('operational', 'icon big') : MAIL_ICON;
  return `${back}<section class="card panel${opts.tone === 'ok' ? ' panel-ok' : ''}" data-testid="${opts.testId}">
  <div class="panel-head">${toneIcon}<h1>${esc(opts.title)}</h1></div>
  ${opts.body.map((b) => `<p>${esc(b)}</p>`).join('')}
  ${opts.action ?? ''}
</section>`;
}

export function renderSubscribePage(o: PageOptions, state: { error?: SubscribeError; email?: string } = {}): string {
  const { locale } = o;
  const err = state.error ? t(locale, ERROR_KEY[state.error]) : '';
  const lang = (value: Locale, label: string) =>
    `<label class="choice"><input type="radio" name="locale" value="${value}"${value === locale ? ' checked' : ''}><span lang="${value}">${label}</span></label>`;
  const form = `<form class="sub-form" method="post" action="${prefix(locale)}/subscribe" novalidate data-testid="subscribe-form">
  ${err ? `<div class="form-error" role="alert" id="sub-error"><strong>${esc(t(locale, 'subscribeErrorTitle'))}</strong><p>${esc(err)}</p></div>` : ''}
  <div class="field">
    <label for="sub-email">${esc(t(locale, 'subscribeEmail'))}</label>
    <input id="sub-email" name="email" type="email" inputmode="email" autocomplete="email" dir="ltr" required maxlength="254" value="${esc(state.email ?? '')}"${err ? ' aria-invalid="true" aria-describedby="sub-error"' : ''}>
  </div>
  <fieldset class="field">
    <legend>${esc(t(locale, 'subscribeLanguage'))}</legend>
    <div class="choices">${lang('en', 'English')}${lang('ar', 'العربية')}</div>
  </fieldset>
  <div class="hp" aria-hidden="true"><label for="sub-website">${esc(t(locale, 'honeypot'))}</label><input id="sub-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  <button class="button" type="submit">${esc(t(locale, 'subscribeButton'))}</button>
  <p class="note">${esc(t(locale, 'subscribeNote'))}</p>
</form>`;
  return shell(o, `${t(locale, 'subscribeTitle')} · ${t(locale, 'pageTitle')}`, panel(locale, { title: t(locale, 'subscribeTitle'), body: [t(locale, 'subscribeIntro')], action: form, testId: 'subscribe-page' }));
}

export function renderSentPage(o: PageOptions): string {
  const { locale } = o;
  return shell(o, `${t(locale, 'sentTitle')} · ${t(locale, 'pageTitle')}`, panel(locale, { title: t(locale, 'sentTitle'), body: [t(locale, 'sentBody'), t(locale, 'sentSpam')], testId: 'subscribe-sent' }));
}

const tokenForm = (locale: Locale, path: string, token: string, label: string, testId: string) =>
  `<form method="post" action="${prefix(locale)}${path}" data-testid="${testId}"><input type="hidden" name="t" value="${esc(token)}"><button class="button" type="submit">${esc(label)}</button></form>`;

const againLink = (locale: Locale) => `<p><a class="button button-quiet" href="${prefix(locale)}/subscribe">${esc(t(locale, 'subscribeAgain'))}</a></p>`;

export function renderConfirmPage(o: PageOptions, state: 'pending' | 'active' | 'unknown', token: string): string {
  const { locale } = o;
  // Without email notifications there is nowhere to subscribe again: no link and no invitation to (hidden when off)
  if (state === 'unknown') return shell(o, t(locale, 'expiredTitle'), panel(locale, { title: t(locale, 'expiredTitle'), body: [t(locale, o.subscribe ? 'expiredBody' : 'expiredBodyOff')], action: o.subscribe ? againLink(locale) : undefined, testId: 'subscribe-expired' }));
  if (state === 'active') return renderSubscribedPage(o);
  return shell(o, t(locale, 'confirmTitle'), panel(locale, { title: t(locale, 'confirmTitle'), body: [t(locale, 'confirmBody')], action: tokenForm(locale, '/subscribe/confirm', token, t(locale, 'confirmButton'), 'confirm-form'), testId: 'subscribe-confirm' }));
}

export function renderSubscribedPage(o: PageOptions): string {
  const { locale } = o;
  return shell(o, t(locale, 'subscribedTitle'), panel(locale, { title: t(locale, 'subscribedTitle'), body: [t(locale, 'subscribedBody')], tone: 'ok', testId: 'subscribe-done' }));
}

export function renderUnsubscribePage(o: PageOptions, known: boolean, token: string): string {
  const { locale } = o;
  if (!known) return renderUnsubscribedPage(o);
  return shell(o, t(locale, 'unsubscribeTitle'), panel(locale, { title: t(locale, 'unsubscribeTitle'), body: [t(locale, 'unsubscribeBody')], action: tokenForm(locale, '/unsubscribe', token, t(locale, 'unsubscribeButton'), 'unsubscribe-form'), testId: 'unsubscribe-page' }));
}

export function renderUnsubscribedPage(o: PageOptions): string {
  const { locale } = o;
  return shell(o, t(locale, 'unsubscribedTitle'), panel(locale, { title: t(locale, 'unsubscribedTitle'), body: [t(locale, 'unsubscribedBody')], action: o.subscribe ? againLink(locale) : undefined, tone: 'ok', testId: 'unsubscribe-done' }));
}
