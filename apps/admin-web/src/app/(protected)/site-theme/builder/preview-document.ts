// The preview's document: the videos site's own component classes (header, rail, tab bar, hero,
// video cards, watch page, forms, menus, dialogs) styled by the site's real stylesheets
// (/theme-kit/site.css, copied from apps/web at build) and the package's compiled CSS.

export type PreviewPage = 'home' | 'watch' | 'settings' | 'components';
export interface PreviewOptions { themeId: string; css: string; page: PreviewPage; mode: 'light' | 'dark'; lang: 'en' | 'ar' }

const I = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  upload: I('<path d="M12 3v12M7 8l5-5 5 5M5 21h14"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  bell: I('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
  home: I('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>'),
  compass: I('<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>'),
  tv: I('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="m8 3 4 4 4-4"/>'),
  bookmark: I('<path d="M6 3h12v18l-6-4-6 4z"/>'),
  history: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>'),
  heart: I('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>'),
  play: I('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
  pause: I('<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>'),
  volume: I('<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7"/>'),
  cog: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  full: I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  like: I('<path d="M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21H7"/>'),
  share: I('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/>'),
  check: I('<path d="m5 12 5 5L20 7"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>'),
};

const T = {
  en: { app: 'Al Ummah Now', search: 'Search videos', upload: 'Upload', home: 'Home', explore: 'Explore', subs: 'Subscriptions', library: 'Library', history: 'History', liked: 'Liked videos', featured: 'Featured', heroTitle: 'The night of the lanterns', heroSub: 'A walk through the old city as the lights come on', watch: 'Watch now', videos: 'Videos', video: (n: number) => ['Recitation by the river', 'Craft and harvest', 'The dome at dawn', 'Lanterns of Cairo', 'Quranic verses on copper', 'Evening reminder'][n % 6], channel: 'Call and Recitation', views: '12K views · 3 days ago', subscribe: 'Subscribe', subscribers: '24K subscribers', like: 'Like', share: 'Share', desc: 'Filmed in the old city at dusk. The lanterns are lit one by one as the call to prayer begins.', related: 'Up next', settings: 'Settings', account: 'Account', notifications: 'Notifications', privacy: 'Privacy', name: 'Display name', namePh: 'Your name', lang: 'Language', autoplay: 'Autoplay next video', emails: 'Email me about new videos', save: 'Save changes', cancel: 'Cancel', delete: 'Delete account', ghost: 'Learn more', menuTitle: 'Menus and dialogs', menu1: 'Save to Watch later', menu2: 'Add to playlist', menu3: 'Report', dialogTitle: 'Leave without saving?', dialogBody: 'Your changes to this video will be lost.', leave: 'Leave', stay: 'Keep editing', toast: 'Saved to Watch later', chips: ['All', 'Lectures', 'Recitations', 'Nasheeds'], live: 'LIVE', empty: 'No videos yet', emptyBody: 'Videos you save appear here.', speed: 'Speed', quality: 'Quality', normal: 'Normal', auto: 'Auto' },
  ar: { app: 'الأمة الآن', search: 'ابحث عن مقاطع', upload: 'رفع', home: 'الرئيسية', explore: 'استكشاف', subs: 'الاشتراكات', library: 'المكتبة', history: 'السجل', liked: 'مقاطع أعجبتك', featured: 'مميز', heroTitle: 'ليلة الفوانيس', heroSub: 'جولة في المدينة القديمة مع إضاءة الأنوار', watch: 'شاهد الآن', videos: 'المقاطع', video: (n: number) => ['تلاوة على ضفاف النهر', 'حرفة وحصاد', 'القبة عند الفجر', 'فوانيس القاهرة', 'آيات على النحاس', 'تذكرة المساء'][n % 6], channel: 'نداء وتلاوة', views: '12 ألف مشاهدة · قبل 3 أيام', subscribe: 'اشتراك', subscribers: '24 ألف مشترك', like: 'أعجبني', share: 'مشاركة', desc: 'صُوّر في المدينة القديمة عند الغروب. تُضاء الفوانيس واحدًا تلو الآخر مع بدء الأذان.', related: 'التالي', settings: 'الإعدادات', account: 'الحساب', notifications: 'الإشعارات', privacy: 'الخصوصية', name: 'الاسم الظاهر', namePh: 'اسمك', lang: 'اللغة', autoplay: 'تشغيل المقطع التالي تلقائيًا', emails: 'راسلني عن المقاطع الجديدة', save: 'حفظ التغييرات', cancel: 'إلغاء', delete: 'حذف الحساب', ghost: 'اعرف المزيد', menuTitle: 'القوائم ومربعات الحوار', menu1: 'حفظ للمشاهدة لاحقًا', menu2: 'إضافة إلى قائمة تشغيل', menu3: 'إبلاغ', dialogTitle: 'المغادرة دون حفظ؟', dialogBody: 'ستفقد تغييراتك على هذا المقطع.', leave: 'مغادرة', stay: 'متابعة التعديل', toast: 'تم الحفظ للمشاهدة لاحقًا', chips: ['الكل', 'محاضرات', 'تلاوات', 'أناشيد'], live: 'مباشر', empty: 'لا توجد مقاطع بعد', emptyBody: 'تظهر هنا المقاطع التي تحفظها.', speed: 'السرعة', quality: 'الجودة', normal: 'عادية', auto: 'تلقائي' },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(t: (typeof T)['en'], current: string, body: string): string {
  const nav = [['home', t.home, ICON.home], ['explore', t.explore, ICON.compass], ['subs', t.subs, ICON.tv], ['library', t.library, ICON.bookmark], ['history', t.history, ICON.history], ['liked', t.liked, ICON.heart]];
  return `<header class="ah"><div class="ah-start"><button class="ic" type="button">${ICON.menu}</button><button class="b b-secondary b-sm" type="button">${ICON.upload}${esc(t.upload)}</button><a class="ah-brand"><span class="ah-logo pv-logo"></span><span>${esc(t.app)}</span></a></div>
<div class="ah-search"><input placeholder="${esc(t.search)}"><button type="button">${ICON.search}</button></div>
<div class="ah-end"><button class="ic" type="button">${ICON.bell}</button><span class="pv-avatar"></span></div></header>
<nav class="nv-panel"><div class="nv-scroll"><div class="nv-group">${nav.slice(0, 3).map(([id, label, icon]) => `<a class="nv"${id === current ? ' aria-current="page"' : ''}>${icon}<span>${esc(label)}</span></a>`).join('')}</div><div class="nv-group">${nav.slice(3).map(([, label, icon]) => `<a class="nv">${icon}<span>${esc(label)}</span></a>`).join('')}</div></div></nav>
<div id="page-content"><main>${body}</main></div>
<nav class="tabbar">${nav.slice(0, 4).map(([id, label, icon]) => `<a class="tb"${id === current ? ' aria-current="page"' : ''}>${icon}<span>${esc(label)}</span></a>`).join('')}</nav>`;
}

const card = (t: (typeof T)['en'], n: number) => `<div class="vc video-card"><div class="vc-t pv-thumb pv-thumb-${n % 6}"><span class="bdg bdg-dur">${n % 2 ? '12:04' : '3:41'}</span>${n === 1 ? `<span class="bdg bdg-live pv-live">${esc(t.live)}</span>` : ''}</div><b>${esc(t.video(n))}</b><small>${esc(t.channel)}<br>${esc(t.views)}</small></div>`;

function home(t: (typeof T)['en']) {
  return shell(t, 'home', `<div class="pv-pad"><section class="home-hero"><div class="home-hero-t pv-thumb pv-thumb-2"></div><div class="home-hero-b"><span class="home-hero-tag">${esc(t.featured)}</span><h2>${esc(t.heroTitle)}</h2><p>${esc(t.heroSub)}</p><a class="b b-primary">${ICON.play}${esc(t.watch)}</a></div></section>
<div class="gal-row pv-chips">${t.chips.map((c, i) => `<button class="chip" type="button" aria-pressed="${i === 0}">${esc(c)}</button>`).join('')}</div>
<h2 class="home-h">${esc(t.videos)}</h2><div data-testid="video-grid">${[0, 1, 2, 3, 4, 5].map((n) => card(t, n)).join('')}</div></div>`);
}

function player(t: (typeof T)['en']) {
  return `<div class="pv-player"><div class="pv-video pv-thumb pv-thumb-3"></div><div class="pv-big">${ICON.play}</div>
<div class="pv-menu"><div class="pv-mi">${ICON.cog}<span>${esc(t.speed)}</span><em>${esc(t.normal)}</em></div><div class="pv-mi pv-sel">${ICON.check}<span>${esc(t.quality)}</span><em>${esc(t.auto)}</em></div></div>
<div class="pv-bar"><div class="pv-track"><div class="pv-buffered"></div><div class="pv-played"></div><div class="pv-handle"></div><span class="pv-tip">4:31</span></div>
<div class="pv-ctl"><span class="pv-btn pv-press">${ICON.pause}</span><span class="pv-btn">${ICON.volume}</span><span class="pv-time">4:31 / 12:04</span><span class="pv-sp"></span><span class="pv-pill">CC</span><span class="pv-btn pv-hover">${ICON.cog}</span><span class="pv-btn">${ICON.full}</span></div></div></div>`;
}

function watch(t: (typeof T)['en']) {
  return shell(t, 'home', `<div class="pv-pad pv-watch"><div class="pv-main">${player(t)}
<div class="watch-details"><h1 class="watch-title">${esc(t.video(3))}</h1><div class="watch-channel"><span class="watch-avatar pv-avatar-lg"></span><div class="watch-channel-meta"><span class="watch-channel-name">${esc(t.channel)}</span><span class="watch-subs">${esc(t.subscribers)}</span></div><button class="b b-primary b-sm watch-sub" type="button">${esc(t.subscribe)}</button></div>
<div class="gal-row pv-actions"><button class="b b-secondary b-sm" type="button">${ICON.like}${esc(t.like)}</button><button class="b b-secondary b-sm" type="button">${ICON.share}${esc(t.share)}</button></div>
<div class="c pv-desc"><b>${esc(t.views)}</b><p>${esc(t.desc)}</p></div></div></div>
<aside class="pv-side"><h3>${esc(t.related)}</h3>${[1, 4, 5].map((n) => card(t, n)).join('')}</aside></div>`);
}

function settings(t: (typeof T)['en']) {
  return shell(t, 'library', `<div class="pv-pad pv-narrow"><h1>${esc(t.settings)}</h1><div class="tabs pv-tabs"><a class="pv-tab" aria-current="page">${esc(t.account)}</a><a class="pv-tab">${esc(t.notifications)}</a><a class="pv-tab">${esc(t.privacy)}</a></div>
<section class="c pv-form"><label class="f-label">${esc(t.name)}<input class="f-input" value="Abdullah" placeholder="${esc(t.namePh)}"></label>
<label class="f-label">${esc(t.lang)}<select class="f-input"><option>English</option><option>العربية</option></select></label>
<div class="pv-row"><span>${esc(t.autoplay)}</span><button class="sw" role="switch" aria-checked="true" type="button"></button></div>
<div class="pv-row"><span>${esc(t.emails)}</span><button class="sw" role="switch" aria-checked="false" type="button"></button></div>
<div class="pv-row"><span class="ck" data-on>${ICON.check}</span><span class="rd" data-on></span><span class="rd"></span></div>
<div class="gal-row"><button class="b b-primary" type="button">${esc(t.save)}</button><button class="b b-secondary" type="button">${esc(t.cancel)}</button><button class="b b-ghost" type="button">${esc(t.ghost)}</button><button class="b b-danger" type="button">${esc(t.delete)}</button></div></section></div>`);
}

function components(t: (typeof T)['en']) {
  return shell(t, 'explore', `<div class="pv-pad pv-narrow"><h1>${esc(t.menuTitle)}</h1><div class="gal-row pv-top">
<div class="menu"><div class="mi">${ICON.bookmark}${esc(t.menu1)}</div><div class="mi is-hover">${ICON.history}${esc(t.menu2)}</div><div class="mi">${ICON.info}${esc(t.menu3)}</div></div>
<div class="dl"><h3>${esc(t.dialogTitle)}</h3><p>${esc(t.dialogBody)}</p><div class="dl-a"><button class="b b-secondary b-sm" type="button">${esc(t.stay)}</button><button class="b b-danger b-sm" type="button">${esc(t.leave)}</button></div></div></div>
<div class="gal-row pv-top"><div class="toast ok">${ICON.check}${esc(t.toast)}</div><span class="bdg bdg-live">${esc(t.live)}</span><span class="bdg bdg-ok">HD</span></div>
<div class="gal-row pv-top"><button class="b b-primary is-hover" type="button">${esc(t.save)}</button><button class="b b-secondary is-hover" type="button">${esc(t.cancel)}</button><button class="b b-primary" type="button" disabled>${esc(t.save)}</button><input class="f-input is-focus pv-w" value="${esc(t.search)}"><input class="f-input is-error pv-w" value="?"></div>
<div class="c empty">${ICON.bookmark}<h4>${esc(t.empty)}</h4><p>${esc(t.emptyBody)}</p></div>
<div class="gal-row pv-top"><div class="sk pv-sk"></div><div class="sk pv-sk"></div></div></div>`);
}

/** Layout glue for the preview only: sizes and positions the site's components need from their pages. */
const PREVIEW_CSS = `
body{margin:0;min-height:100vh;font-family:Inter,'Noto Kufi Arabic',system-ui,sans-serif}html[lang=ar] body{font-family:'Noto Kufi Arabic',Inter,system-ui,sans-serif}
*{box-sizing:border-box}a{color:inherit;text-decoration:none}button{font:inherit}
.pv-pad{padding:20px clamp(16px,2.4vw,36px);display:grid;gap:20px;max-width:1400px;margin-inline:auto}
.pv-logo{display:inline-block;width:32px;height:32px;background:radial-gradient(circle at 50% 35%,var(--fanous-color-primary-sheen),var(--fanous-color-primary) 70%)}
.pv-avatar{display:inline-block;width:32px;height:32px;border-radius:50%;background:var(--fanous-color-surface-raised);box-shadow:0 0 0 1px var(--fanous-c-nav-border)}
.pv-avatar-lg{background:radial-gradient(circle at 40% 35%,var(--fanous-color-primary-sheen),var(--fanous-color-secondary))}
.pv-thumb{background:linear-gradient(135deg,var(--fanous-color-hero-start),var(--fanous-color-surface-raised))}
.pv-thumb-1{background:linear-gradient(160deg,var(--fanous-brand-night),var(--fanous-brand-lantern))}.pv-thumb-2{background:radial-gradient(60% 80% at 70% 30%,var(--fanous-brand-glow),var(--fanous-brand-night) 70%)}.pv-thumb-3{background:linear-gradient(180deg,var(--fanous-brand-night-deep),var(--fanous-brand-earth))}.pv-thumb-4{background:linear-gradient(120deg,var(--fanous-brand-earth),var(--fanous-brand-glow))}.pv-thumb-5{background:linear-gradient(200deg,var(--fanous-brand-night),var(--fanous-color-motif))}
.pv-live{position:absolute;inset-block-start:6px;inset-inline-start:6px}
[data-testid=video-grid]{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:24px 16px}
.home-hero-t{min-height:220px}.pv-chips{margin-block-start:4px}
.pv-watch{grid-template-columns:minmax(0,1fr) 340px;align-items:start}.pv-side{display:grid;gap:14px}.pv-side h3{margin:0;font-size:16px}
.pv-actions{margin-block:12px}.pv-desc{display:grid;gap:6px;font-size:14px}.pv-desc p{margin:0}
.pv-player{position:relative;aspect-ratio:16/9;border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--m-player);isolation:isolate}
.pv-player::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:var(--m-player-ring);pointer-events:none}
.pv-video{position:absolute;inset:0}
.pv-big{position:absolute;inset-block-start:38%;inset-inline-start:50%;translate:-50% -50%;display:grid;place-items:center;width:72px;height:72px;border-radius:var(--fanous-player-shape);background:var(--fanous-player-big);color:var(--fanous-player-big-icon);box-shadow:var(--fanous-player-big-edge)}html[dir=rtl] .pv-big{translate:50% -50%}.pv-big svg{width:30px;height:30px}
.pv-bar{position:absolute;inset-inline:var(--fanous-player-bar-inset);inset-block-end:var(--fanous-player-bar-inset);padding:var(--fanous-player-bar-pad);background:var(--fanous-player-bar);box-shadow:var(--fanous-player-bar-edge);border-radius:var(--fanous-player-bar-radius);-webkit-backdrop-filter:var(--fanous-player-blur);backdrop-filter:var(--fanous-player-blur);color:var(--fanous-player-icon)}
.pv-track{position:relative;height:5px;border-radius:3px;background:var(--fanous-player-track);box-shadow:var(--fanous-player-track-edge);margin:0 8px 8px}
.pv-buffered{position:absolute;inset-block:0;inset-inline-start:0;width:62%;border-radius:inherit;background:var(--fanous-player-buffered)}
.pv-played{position:absolute;inset-block:0;inset-inline-start:0;width:38%;border-radius:inherit;background:var(--fanous-player-played);box-shadow:var(--fanous-player-glow)}
.pv-handle{position:absolute;top:50%;inset-inline-start:38%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--fanous-player-handle);box-shadow:var(--fanous-player-handle-edge)}
.pv-tip{position:absolute;bottom:14px;inset-inline-start:38%;translate:-50% 0;padding:2px 8px;border-radius:6px;font-size:12px;background:var(--fanous-player-tip-bg);color:var(--fanous-player-tip-text);box-shadow:var(--fanous-player-tip-edge)}
.pv-ctl{display:flex;align-items:center;gap:4px}.pv-btn{display:grid;place-items:center;width:40px;height:40px;border-radius:var(--fanous-player-shape)}.pv-btn svg{width:22px;height:22px}.pv-hover{background:var(--fanous-player-hover)}.pv-press{background:var(--fanous-player-press)}
.pv-time{font-size:13px;color:var(--fanous-player-dim);padding-inline:6px}.pv-sp{flex:1}.pv-pill{font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;background:var(--fanous-player-pill);box-shadow:inset 0 0 0 1px var(--fanous-player-pill-edge)}
.pv-menu{position:absolute;inset-block-end:76px;inset-inline-end:12px;width:220px;padding:6px;border-radius:12px;background:var(--fanous-player-menu);box-shadow:var(--fanous-player-menu-edge);color:var(--fanous-player-icon);font-size:14px}
.pv-mi{display:flex;align-items:center;gap:10px;min-height:38px;padding-inline:10px;border-radius:8px}.pv-mi svg{width:18px;height:18px}.pv-mi span{flex:1}.pv-mi em{font-style:normal;color:var(--fanous-player-dim)}.pv-sel{background:var(--fanous-player-menu-selected)}.pv-sel svg{color:var(--fanous-player-accent)}
.pv-narrow{max-width:880px}.pv-narrow h1{margin:0;font-size:26px}
.pv-tabs{gap:4px}.pv-tab{padding:10px 14px;color:var(--fanous-c-tabs-text);border-block-end:2px solid transparent}.pv-tab[aria-current]{color:var(--fanous-c-tabs-active-text);border-color:var(--fanous-c-tabs-indicator);font-weight:600}
.pv-form{display:grid;gap:18px}.pv-row{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--fanous-c-form-label)}
.pv-top{align-items:flex-start}.pv-w{width:180px}.pv-sk{width:220px;height:120px}
@media(max-width:1023px){.pv-watch{grid-template-columns:minmax(0,1fr)}.tabbar{display:flex;position:fixed;inset-inline:0;inset-block-end:0;z-index:40;justify-content:space-around;height:60px;box-shadow:0 -1px 0 var(--fanous-c-drawer-divider)}.tb{position:relative;display:grid;justify-items:center;gap:2px;padding-top:8px;font-size:11px;color:var(--fanous-c-drawer-text)}.tb svg{width:22px;height:22px}#page-content{padding-block-end:72px}}
`;

export function previewDocument({ themeId, css, page, mode, lang }: PreviewOptions): string {
  const t = T[lang];
  const body = page === 'home' ? home(t) : page === 'watch' ? watch(t) : page === 'settings' ? settings(t) : components(t);
  // The compiled CSS is the package's own, validated: it cannot leave this <style>.
  // `only <mode>` and darkreader-lock keep browser dark modes (Chrome's auto dark, Dark Reader) from
  // repainting the preview: they lightened the light preview's text and darkened its fills, so it
  // no longer showed the theme's colours.
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" data-theme="${esc(themeId)}" data-rail="closed" class="${mode === 'dark' ? 'dark' : ''}" style="color-scheme:only ${mode}">
<head><meta charset="utf-8"><meta name="color-scheme" content="only ${mode}"><meta name="darkreader-lock"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme-kit/site.css"><style id="pv-base">${PREVIEW_CSS}</style><style id="pv-theme">${safeCss}</style></head>
<body>${body}</body></html>`;
}
