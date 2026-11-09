'use client';
// Prototype only: every component in every state, for review.
import { useParams } from 'next/navigation';
import { Bell, Check, CheckCircle2, Flag, Inbox, LogOut, Plus, Search, Settings, Trash2, Upload, User, XCircle } from 'lucide-react';
import { PlayerChromeView, type ChromeActions, type ChromeState } from '@/components/ThemeDemo/PlayerChromeView';
import { PlayerErrorView } from '@/components/ThemeDemo/PlayerErrorView';

const noop = () => undefined;
const A: ChromeActions = { toggle: noop, seek: noop, setVolume: noop, toggleMute: noop, onNext: noop, toggleFull: noop, toggleTheatre: noop, togglePip: noop, setQuality: noop, setRate: noop, setCaption: noop, setAudio: noop, shortcuts: noop, replay: noop, goLive: noop };

const T = {
  en: { h: 'Components', sub: 'Every component in every state.', buttons: 'Buttons', primary: 'Publish video', secondary: 'Save draft', ghost: 'Cancel', danger: 'Delete video', states: ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'], sizes: 'Small, medium, large', forms: 'Forms', title: 'Video title', titleH: 'Up to 100 characters.', ph: 'Name your video', err: 'Add a title to continue.', ok: 'This handle is available.', cat: 'Category', desc: 'Description', cards: 'Video and channel cards', vt: 'Understanding Surah Al-Kahf', vc: 'Masjid An-Nur', vm: '12K views, 2 days ago', ch: 'Dar Al-Ilm', chm: '48K subscribers', sub2: 'Subscribe', tabs: 'Tabs and chips', tabL: ['Home', 'Videos', 'Playlists', 'About'], chips: ['All', 'Lectures', 'Recitation', 'Travel'], badges: 'Badges', live: 'Live', dur: '42:10', st: 'Verified', overlays: 'Menus, dialogs and toasts', profile: 'Your profile', settings: 'Settings', out: 'Sign out', dlgT: 'Delete this video?', dlgB: 'This removes it for everyone and cannot be undone.', tok: 'Video published', terr: 'Upload failed. Try again.', emp: 'Empty and loading', et: 'No saved videos yet', eb: 'Save a lecture to find it here later.', ea: 'Browse videos', player: 'Player', pIdle: 'Before playing', pHover: 'Playing, seeking', pMenu: 'Settings menu', pBuf: 'Buffering', pEnd: 'Up next', pLive: 'Live', pErr: 'Could not play', errT: 'This video can\'t play right now', errB: 'Check your connection and try again.', retry: 'Try again', rep: 'Report a problem', short: 'Short', nt: 'Stories of the Prophets, part 3', sh: 'Sunrise over the dunes' },
  ar: { h: 'المكوّنات', sub: 'كل مكوّن بكل حالاته.', buttons: 'الأزرار', primary: 'نشر المقطع', secondary: 'حفظ المسودة', ghost: 'إلغاء', danger: 'حذف المقطع', states: ['الافتراضي', 'عند التمرير', 'عند الضغط', 'عند التركيز', 'معطّل'], sizes: 'صغير، متوسط، كبير', forms: 'النماذج', title: 'عنوان المقطع', titleH: 'حتى ١٠٠ حرف.', ph: 'سمِّ مقطعك', err: 'أضف عنوانًا للمتابعة.', ok: 'هذا الاسم متاح.', cat: 'الفئة', desc: 'الوصف', cards: 'بطاقات المقاطع والقنوات', vt: 'فهم سورة الكهف', vc: 'مسجد النور', vm: '١٢ ألف مشاهدة، قبل يومين', ch: 'دار العلم', chm: '٤٨ ألف مشترك', sub2: 'اشتراك', tabs: 'التبويبات والشرائح', tabL: ['الرئيسية', 'المقاطع', 'القوائم', 'حول'], chips: ['الكل', 'محاضرات', 'تلاوات', 'سفر'], badges: 'الشارات', live: 'مباشر', dur: '٤٢:١٠', st: 'موثّق', overlays: 'القوائم والحوارات والتنبيهات', profile: 'ملفك الشخصي', settings: 'الإعدادات', out: 'تسجيل الخروج', dlgT: 'حذف هذا المقطع؟', dlgB: 'سيُحذف للجميع ولا يمكن التراجع.', tok: 'تم نشر المقطع', terr: 'فشل الرفع. حاول مرة أخرى.', emp: 'الفراغ والتحميل', et: 'لا توجد مقاطع محفوظة بعد', eb: 'احفظ محاضرة لتجدها هنا لاحقًا.', ea: 'تصفّح المقاطع', player: 'المشغّل', pIdle: 'قبل التشغيل', pHover: 'أثناء التشغيل والتقديم', pMenu: 'قائمة الإعدادات', pBuf: 'التحميل', pEnd: 'التالي', pLive: 'بث مباشر', pErr: 'تعذّر التشغيل', errT: 'تعذّر تشغيل هذا المقطع الآن', errB: 'تحقق من اتصالك وحاول مرة أخرى.', retry: 'حاول مرة أخرى', rep: 'الإبلاغ عن مشكلة', short: 'مقطع قصير', nt: 'قصص الأنبياء، الجزء الثالث', sh: 'شروق فوق الكثبان' },
};

export default function ComponentsGallery() {
  const { locale } = useParams<{ locale: string }>();
  const lang = locale === 'ar' ? 'ar' : 'en';
  const t = T[lang];
  const base: ChromeState = { lang, playing: true, started: true, time: 86, duration: 2530, buffered: 38, volume: 0.7, muted: false, buffering: false, ended: false, active: true, full: false, theatre: false, live: false, behindLive: 0, chapters: [420, 980, 1660], hasNext: true, qualities: [{ id: 'auto', label: lang === 'ar' ? 'تلقائي' : 'Auto' }, { id: '2', label: '1080p' }, { id: '1', label: '720p' }, { id: '0', label: '360p' }], quality: 'auto', rate: 1, captions: [{ id: 'off', label: lang === 'ar' ? 'إيقاف' : 'Off' }, { id: '0', label: lang === 'ar' ? 'العربية' : 'English' }], caption: '0', audio: [], audioId: '', canPip: true, next: { title: t.nt, channel: t.ch } };
  const Variant = ({ c, l }: { c: string; l: string }) => <div className="gal-row">{['', 'is-hover', 'is-press', 'is-focus'].map((s, i) => <button key={s} type="button" className={`b ${c} ${s}`}>{l}<span className="sr-only">{t.states[i]}</span></button>)}<button type="button" className={`b ${c}`} disabled>{l}</button></div>;
  const P = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="grid gap-2"><span className="gal-note">{title}</span><div className="gal-p">{children}</div></div>;
  return (
    <main className="gal">
      <header><h1>{t.h}</h1><p className="gal-note">{t.sub}</p></header>
      <section><h2>{t.buttons}</h2><div className="grid gap-3">
        <div className="gal-row gal-note">{t.states.map((s) => <span key={s}>{s}</span>)}</div>
        <Variant c="b-primary" l={t.primary} /><Variant c="b-secondary" l={t.secondary} /><Variant c="b-ghost" l={t.ghost} /><Variant c="b-danger" l={t.danger} />
        <div className="gal-row"><span className="gal-note">{t.sizes}</span><button type="button" className="b b-primary b-sm">{t.primary}</button><button type="button" className="b b-primary">{t.primary}</button><button type="button" className="b b-primary b-lg">{t.primary}</button><button type="button" className="b b-secondary b-icon" aria-label={t.settings}><Settings aria-hidden="true" /></button><button type="button" className="b b-primary b-icon" aria-label={t.primary}><Upload aria-hidden="true" /></button></div>
      </div></section>
      <section className="c"><h2>{t.forms}</h2><div className="gal-grid">
        <label className="f-label">{t.title}<input className="f-input" placeholder={t.ph} /><span className="f-help">{t.titleH}</span></label>
        <label className="f-label">{t.title}<input className="f-input is-focus" defaultValue={t.vt} /></label>
        <label className="f-label">{t.title}<input className="f-input is-error" aria-invalid="true" /><span className="f-err">{t.err}</span></label>
        <label className="f-label">{t.title}<input className="f-input" defaultValue="@darilm" /><span className="f-ok">{t.ok}</span></label>
        <label className="f-label">{t.title}<input className="f-input" disabled defaultValue={t.vt} /></label>
        <label className="f-label">{t.cat}<select className="f-input"><option>{t.chips[1]}</option><option>{t.chips[2]}</option></select></label>
        <label className="f-label">{t.desc}<textarea className="f-input" rows={3} placeholder={t.ph} /></label>
        <div className="grid gap-3"><div className="gal-row"><button type="button" role="switch" aria-checked="true" className="sw" aria-label="on" /><button type="button" role="switch" aria-checked="false" className="sw" aria-label="off" /></div><div className="gal-row"><span className="ck" data-on=""><Check aria-hidden="true" /></span><span className="ck" /><span className="rd" data-on="" /><span className="rd" /></div></div>
      </div></section>
      <section><h2>{t.cards}</h2><div className="gal-grid">
        <div className="vc"><div className="vc-t"><span className="bdg bdg-dur">{t.dur}</span></div><b>{t.vt}</b><small>{t.vc}</small><small>{t.vm}</small></div>
        <div className="vc is-hover"><div className="vc-t"><span className="bdg bdg-dur">{t.dur}</span></div><b>{t.vt}</b><small>{t.vc}</small><small>{t.vm}</small></div>
        <div className="vc"><div className="vc-t"><span className="bdg bdg-live">{t.live}</span></div><b>{t.vt}</b><small>{t.vc}</small><small>{t.vm}</small></div>
        <div className="c grid justify-items-center gap-2 text-center"><div className="hero" style={{ width: 72, height: 72, borderRadius: '50%' }} /><b>{t.ch}</b><small className="gal-note">{t.chm}</small><button type="button" className="b b-primary b-sm">{t.sub2}</button></div>
      </div></section>
      <section><h2>{t.tabs}</h2><div className="grid gap-4"><div className="tabs" role="tablist">{t.tabL.map((l, i) => <button key={l} type="button" role="tab" className="tab" aria-selected={i === 0}>{l}</button>)}</div><div className="gal-row">{t.chips.map((l, i) => <button key={l} type="button" className="chip" aria-pressed={i === 0}>{l}</button>)}<button type="button" className="chip is-hover">{t.chips[3]}</button></div><div className="gal-row"><span className="bdg bdg-live">{t.live}</span><span className="bdg bdg-dur">{t.dur}</span><span className="bdg bdg-ok"><CheckCircle2 size={12} aria-hidden="true" />{t.st}</span></div></div></section>
      <section><h2>{t.overlays}</h2><div className="gal-row" style={{ alignItems: 'flex-start' }}>
        <div className="menu"><div className="mi"><User aria-hidden="true" />{t.profile}</div><div className="mi is-hover"><Settings aria-hidden="true" />{t.settings}<small>⌘,</small></div><div className="mi"><Bell aria-hidden="true" />{t.chips[0]}</div><div className="mi"><LogOut aria-hidden="true" />{t.out}</div></div>
        <div className="dl"><h3>{t.dlgT}</h3><p>{t.dlgB}</p><div className="dl-a"><button type="button" className="b b-ghost">{t.ghost}</button><button type="button" className="b b-danger"><Trash2 aria-hidden="true" />{t.danger}</button></div></div>
        <div className="grid gap-2"><div className="toast ok"><CheckCircle2 aria-hidden="true" />{t.tok}</div><div className="toast err"><XCircle aria-hidden="true" />{t.terr}</div></div>
      </div></section>
      <section><h2>{t.emp}</h2><div className="gal-grid"><div className="c empty"><Inbox aria-hidden="true" /><h4>{t.et}</h4><p>{t.eb}</p><button type="button" className="b b-primary b-sm"><Search aria-hidden="true" />{t.ea}</button></div><div className="grid gap-2"><div className="sk" style={{ aspectRatio: '16/9' }} /><div className="sk" style={{ height: 14 }} /><div className="sk" style={{ height: 12, width: '60%' }} /></div></div></section>
      <section><h2>{t.player}</h2><div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))' }}>
        <div className="grid gap-3" style={{ gridColumn: '1 / -1' }}>
          <span className="gal-note">{lang === 'ar' ? 'المشغّل في كل سمة، فوق إطار فاتح وآخر داكن' : 'The player in every theme, over a bright and a dark frame'}</span>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))' }}>
            {(['lantern', 'zujaj', 'nahas', 'fawanees'] as const).flatMap((id) => ['#f4efe4,#d9d2c2', '#0a1016,#1b2b36'].map((bg, i) => (
              <div key={`${id}${i}`} className={`grid gap-1 pt-${id}`}><span className="gal-note">{id}, {i ? 'dark frame' : 'bright frame'}</span><div className="gal-p" style={{ background: `linear-gradient(135deg,${bg})` }}><PlayerChromeView s={{ ...base, playing: false, started: i === 0 ? false : true }} a={A} hoverPct={41} /></div></div>
            )))}
          </div>
        </div>
        <P title={t.pIdle}><PlayerChromeView s={{ ...base, playing: false, started: false, time: 0, buffered: 0 }} a={A} /></P>
        <P title={t.pHover}><PlayerChromeView s={base} a={A} hoverPct={41} /></P>
        <P title={lang === 'ar' ? 'استكمال المشاهدة' : 'Resumed'}><PlayerChromeView s={{ ...base, resumed: true, time: 1240 }} a={A} /></P>
        <P title={t.pMenu}><PlayerChromeView s={base} a={A} initialPanel="root" /></P>
        <P title={t.pBuf}><PlayerChromeView s={{ ...base, buffering: true }} a={A} /></P>
        <P title={t.pEnd}><PlayerChromeView s={{ ...base, ended: true, playing: false }} a={A} /></P>
        <P title={t.pLive}><PlayerChromeView s={{ ...base, live: true, chapters: [] }} a={A} /></P>
        <P title={t.pErr}><PlayerErrorView title={t.errT} description={t.errB} retryLabel={t.retry} onRetry={noop} reportLabel={t.rep} onReport={noop} dir={lang === 'ar' ? 'rtl' : 'ltr'} /></P>
        <div className="grid gap-2"><span className="gal-note">{t.short}</span><div className="shorts"><div className="pc-side"><button type="button" className="pc-b" aria-label="+"><Plus aria-hidden="true" /></button><button type="button" className="pc-b" aria-label={t.rep}><Flag aria-hidden="true" /></button></div><div className="shorts-t">{t.sh}</div></div></div>
      </div></section>
    </main>
  );
}
