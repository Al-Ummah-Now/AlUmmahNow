/**
 * The Web Push service worker (#1287), served at /push-sw.js (app/push-sw.js/route.ts) and
 * registered with the scope /push/, so it never sees page or asset requests: it only shows
 * pushes and opens them.
 *
 * Pushes carry the notification key + params (processor push/senders/webpush.ts), never text:
 * the worker renders them with the same en/ar templates as the notification center
 * (notificationTemplates), in the language the browser registered with (`lang`). Review alerts
 * (staff) arrive rendered. The strings are part of the script, so a copy change changes the
 * bytes and browsers pick up the new worker.
 */
import { AR_TRANSLATIONS, EN_TRANSLATIONS } from '@/lib/i18n/translations';
import { notificationTemplates } from '@/lib/websocket/notification-text';

export { PUSH_SW_PATH, PUSH_SW_SCOPE } from './service-worker-paths';

/** Plain JavaScript, run by the browser in the worker's global scope (no imports, no bundler). */
const WORKER_BODY = String.raw`
'use strict';

const pickLang = (lang) => (typeof lang === 'string' && lang.toLowerCase().startsWith('ar') ? 'ar' : 'en');

// Same rule as localizeParams: "<name>_<lang>" (e.g. channelName_ar) replaces "<name>"
function localizeParams(params, lang) {
  const out = Object.assign({}, params || {});
  const suffix = '_' + lang;
  for (const key of Object.keys(params || {})) {
    const value = params[key];
    if (key.endsWith(suffix) && value !== '' && value !== undefined && value !== null) out[key.slice(0, -suffix.length)] = value;
  }
  return out;
}

// Numbers like locale-format: Arabic ٠–٩ (ar-u-nu-arab), English 0–9, pinned in every browser
// Arabic is never grouped, as in locale-format (owner 2026-11-21): ICU's «٬» looks like the decimal «٫»
const NUMBER = { ar: new Intl.NumberFormat('ar-u-nu-arab', { useGrouping: false }), en: new Intl.NumberFormat('en-u-nu-latn') }; // locale-format: machine (worker script, no imports)
// lineText (shared-types bidi): what people typed is one line without direction controls
const line = (text) => String(text).replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\n\r\u001c-\u001e\u0085\u2029]+/g, ' ');
const fill = (template, params, lang) =>
  String(template || '').replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null) return '';
    return typeof value === 'number' ? NUMBER[lang === 'ar' ? 'ar' : 'en'].format(value) : line(value);
  });

function renderNotification(data) {
  const lang = pickLang(data.lang);
  const strings = STRINGS[lang];
  const template = strings.keys[data.key];
  let params = localizeParams(data.params, lang);
  if (!template) return { lang, title: strings.fallbackTitle, body: '' };
  if (template.reasons) {
    const code = String(params.reason || 'other');
    params = Object.assign({}, params, { reason: template.reasons[code] || template.reasons.other || '' });
  }
  return { lang, title: fill(template.title, params, lang), body: fill(template.message, params, lang) };
}

// Server action URLs are locale-less ("/video/123"): same rule as localizeActionUrl
function openUrl(url, lang) {
  const safeLang = lang === 'ar' ? 'ar' : 'en';
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\') || /[\u0000-\u001F\u007F]/.test(url)) {
    return '/' + safeLang + '/notifications';
  }
  if (/^\/(en|ar)(\/|$|\?)/.test(url)) return url;
  return '/' + safeLang + url;
}

function parse(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch (e) {
    return null;
  }
}

async function show(data) {
  if (!data || typeof data !== 'object') {
    // A push must show something (userVisibleOnly): the generic line in the browser's language
    const lang = pickLang(self.navigator && self.navigator.language);
    return self.registration.showNotification(STRINGS[lang].fallbackTitle, { lang, dir: lang === 'ar' ? 'rtl' : 'ltr', icon: ICON, badge: BADGE, data: { url: openUrl(null, lang) } });
  }
  if (data.kind === 'review_clear') {
    const shown = await self.registration.getNotifications({ tag: 'review:' + data.reviewId });
    shown.forEach((n) => n.close());
    return;
  }
  if (data.kind === 'review_alert') {
    const lang = pickLang(self.navigator && self.navigator.language);
    return self.registration.showNotification(String(data.title || ''), {
      body: String(data.body || ''),
      tag: 'review:' + data.reviewId,
      renotify: true,
      requireInteraction: true,
      icon: ICON,
      badge: BADGE,
      data: { url: openUrl(data.url, lang) },
    });
  }
  const text = renderNotification(data);
  return self.registration.showNotification(text.title, {
    body: text.body,
    lang: text.lang,
    dir: text.lang === 'ar' ? 'rtl' : 'ltr',
    tag: data.notificationId ? 'n:' + data.notificationId : undefined,
    icon: ICON,
    badge: BADGE,
    data: { url: openUrl(data.url, text.lang) },
  });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => event.waitUntil(show(parse(event))));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  let parsed;
  try {
    parsed = new URL(typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/', self.location.origin);
  } catch (e) {
    parsed = new URL('/', self.location.origin);
  }
  const target = parsed.origin === self.location.origin ? parsed.href : new URL('/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = windows.find((w) => w.url === target);
      if (same) return same.focus();
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open && 'navigate' in open) {
        await open.focus();
        return open.navigate(target);
      }
      return self.clients.openWindow(target);
    })(),
  );
});
`;

/** The worker script: the templates for both languages, then the code. */
export function pushServiceWorkerSource(): string {
  const strings = {
    en: { fallbackTitle: EN_TRANSLATIONS.notifications.systemNotification, keys: notificationTemplates(EN_TRANSLATIONS) },
    ar: { fallbackTitle: AR_TRANSLATIONS.notifications.systemNotification, keys: notificationTemplates(AR_TRANSLATIONS) },
  };
  return (
    `/* Al Ummah Now Web Push service worker (generated by apps/web/src/lib/push/service-worker.ts) */\n` +
    `const STRINGS = ${JSON.stringify(strings)};\n` +
    `const ICON = '/icon-192.png';\nconst BADGE = '/favicon-96x96.png';\n` +
    WORKER_BODY
  );
}
