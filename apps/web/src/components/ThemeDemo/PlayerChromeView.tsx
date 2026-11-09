'use client';
// Prototype only: the player's visual layer. Pure view, so the gallery can show every state.
import { useState, type PointerEvent as RP } from 'react';
import { Captions, Check, ChevronLeft, ChevronRight, Keyboard, Maximize, Minimize, Pause, PictureInPicture2, Play, RectangleHorizontal, RotateCcw, Settings, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';

export const PLAYER_COPY = {
  en: { play: 'Play', pause: 'Pause', next: 'Next video', mute: 'Mute', unmute: 'Unmute', volume: 'Volume', seek: 'Seek', captions: 'Captions', settings: 'Settings', pip: 'Picture in picture', theatre: 'Theatre mode', full: 'Full screen', exitFull: 'Exit full screen', quality: 'Quality', speed: 'Speed', audio: 'Audio track', shortcuts: 'Keyboard shortcuts', auto: 'Auto', off: 'Off', normal: 'Normal', back: 'Back', upNext: 'Up next', replay: 'Watch again', playNext: 'Play now', live: 'Live', goLive: 'Go to live', behind: 'behind' },
  ar: { play: 'تشغيل', pause: 'إيقاف مؤقت', next: 'المقطع التالي', mute: 'كتم الصوت', unmute: 'إلغاء الكتم', volume: 'مستوى الصوت', seek: 'التقديم', captions: 'الترجمة', settings: 'الإعدادات', pip: 'صورة داخل صورة', theatre: 'وضع المسرح', full: 'ملء الشاشة', exitFull: 'الخروج من ملء الشاشة', quality: 'الجودة', speed: 'السرعة', audio: 'المسار الصوتي', shortcuts: 'اختصارات لوحة المفاتيح', auto: 'تلقائي', off: 'إيقاف', normal: 'عادية', back: 'رجوع', upNext: 'التالي', replay: 'إعادة المشاهدة', playNext: 'شغّل الآن', live: 'مباشر', goLive: 'الانتقال إلى البث', behind: 'تأخير' },
};

export interface Option { id: string; label: string }
export interface ChromeState {
  lang: 'en' | 'ar'; playing: boolean; started: boolean; time: number; duration: number; buffered: number; volume: number; muted: boolean;
  buffering: boolean; ended: boolean; active: boolean; full: boolean; theatre: boolean; live: boolean; behindLive: number; chapters: number[]; hasNext: boolean;
  qualities: Option[]; quality: string; rate: number; captions: Option[]; caption: string; audio: Option[]; audioId: string; canPip: boolean;
  next?: { title: string; channel: string; thumb?: string };
}
export interface ChromeActions {
  toggle(): void; seek(t: number): void; setVolume(v: number): void; toggleMute(): void; onNext(): void; toggleFull(): void; toggleTheatre(): void; togglePip(): void;
  setQuality(id: string): void; setRate(r: number): void; setCaption(id: string): void; setAudio(id: string): void; shortcuts(): void; replay(): void; goLive(): void;
}

export const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
type Panel = null | 'root' | 'quality' | 'speed' | 'captions' | 'audio';

export function PlayerChromeView({ s, a, initialPanel = null, hoverPct }: { s: ChromeState; a: ChromeActions; initialPanel?: Panel; hoverPct?: number }) {
  const c = PLAYER_COPY[s.lang];
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [hover, setHover] = useState<number | null>(hoverPct ?? null);
  const dur = s.duration || 0;
  const pct = dur ? (s.time / dur) * 100 : 0;
  const pctAt = (e: RP<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const VolIcon = s.muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2;
  const Back = s.lang === 'ar' ? ChevronRight : ChevronLeft; const More = s.lang === 'ar' ? ChevronLeft : ChevronRight;
  const showControls = s.active || !s.playing || panel !== null;
  const row = (label: string, value: string, go: Panel) => <button type="button" className="pc-mi" onClick={() => setPanel(go)}><span>{label}</span><small>{value}</small><More aria-hidden="true" /></button>;
  const list = (title: string, opts: Option[], cur: string, set: (id: string) => void) => (
    <><button type="button" className="pc-mi pc-back" onClick={() => setPanel('root')}><Back aria-hidden="true" /><span>{title}</span></button>
      {opts.map((o) => <button type="button" key={o.id} className="pc-mi" role="menuitemradio" aria-checked={o.id === cur} onClick={() => { set(o.id); setPanel('root'); }}><span>{o.label}</span>{o.id === cur && <Check aria-hidden="true" />}</button>)}</>
  );
  const qLabel = s.qualities.find((q) => q.id === s.quality)?.label ?? c.auto;
  const capLabel = s.captions.find((q) => q.id === s.caption)?.label ?? c.off;
  return (
    <div className="pc" data-active={showControls} data-started={s.started} dir="ltr">
      {!s.ended && <button type="button" className="pc-hit" aria-label={s.playing ? c.pause : c.play} tabIndex={-1} onClick={a.toggle} />}
      {!s.started && !s.buffering && <button type="button" className="pc-big" aria-label={c.play} onClick={a.toggle}><Play aria-hidden="true" /></button>}
      {s.buffering && <div className="pc-spin" role="status" aria-label="…"><span /><span /><span /></div>}
      {s.ended && (
        <div className="pc-end" dir={s.lang === 'ar' ? 'rtl' : 'ltr'}>
          {s.next ? (
            <div className="pc-next">
              <small>{c.upNext}</small>
              <div className="pc-next-t" style={s.next.thumb ? { backgroundImage: `url("${s.next.thumb}")` } : undefined} />
              <strong>{s.next.title}</strong><span>{s.next.channel}</span>
              <div className="pc-next-a"><button type="button" className="b b-primary b-sm" onClick={a.onNext}><SkipForward aria-hidden="true" />{c.playNext}</button><button type="button" className="pc-txt" onClick={a.replay}><RotateCcw aria-hidden="true" />{c.replay}</button></div>
            </div>
          ) : <button type="button" className="b b-primary" onClick={a.replay}><RotateCcw aria-hidden="true" />{c.replay}</button>}
        </div>
      )}
      <div className="pc-bar" hidden={!showControls || undefined}>
        <div className="pc-track" role="slider" tabIndex={0} aria-label={c.seek} aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(s.time)} aria-valuetext={`${fmt(s.time)} / ${fmt(dur)}`}
          onPointerMove={(e) => setHover(pctAt(e) * 100)} onPointerLeave={() => setHover(hoverPct ?? null)}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); a.seek(pctAt(e) * dur); }}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.stopPropagation(); a.seek(s.time + 5); } if (e.key === 'ArrowLeft') { e.stopPropagation(); a.seek(s.time - 5); } }}>
          <div className="pc-rail">
            <i className="pc-buf" style={{ width: `${s.buffered}%` }} />
            <i className="pc-played" style={{ width: `${pct}%` }} />
            {s.chapters.map((t) => <b key={t} className="pc-mark" style={{ left: `${dur ? (t / dur) * 100 : 0}%` }} />)}
          </div>
          <i className="pc-handle" style={{ left: `${pct}%` }} />
          {hover !== null && <span className="pc-tip" style={{ left: `clamp(24px, ${hover}%, calc(100% - 24px))` }}>{fmt((hover / 100) * dur)}</span>}
        </div>
        <div className="pc-row">
          <button type="button" className="pc-b" aria-label={s.playing ? c.pause : c.play} onClick={a.toggle}>{s.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          {s.hasNext && <button type="button" className="pc-b" aria-label={c.next} onClick={a.onNext}><SkipForward aria-hidden="true" /></button>}
          <div className="pc-vol">
            <button type="button" className="pc-b" aria-label={s.muted ? c.unmute : c.mute} onClick={a.toggleMute}><VolIcon aria-hidden="true" /></button>
            <input type="range" min={0} max={1} step={0.05} value={s.muted ? 0 : s.volume} aria-label={c.volume} onChange={(e) => a.setVolume(Number(e.target.value))} style={{ '--v': `${(s.muted ? 0 : s.volume) * 100}%` } as React.CSSProperties} />
          </div>
          {s.live ? (
            <button type="button" className="pc-live" data-behind={s.behindLive > 10} onClick={a.goLive} aria-label={c.goLive}><i />{c.live}{s.behindLive > 10 && <small dir={s.lang === 'ar' ? 'rtl' : 'ltr'}>{fmt(s.behindLive)} {c.behind}</small>}</button>
          ) : <span className="pc-time">{fmt(s.time)}<small> / {fmt(dur)}</small></span>}
          <span className="pc-gap" />
          {s.captions.length > 0 && <button type="button" className="pc-b" aria-label={c.captions} aria-pressed={s.caption !== 'off'} data-on={s.caption !== 'off'} onClick={() => a.setCaption(s.caption === 'off' ? s.captions[1]?.id ?? 'off' : 'off')}><Captions aria-hidden="true" /></button>}
          <button type="button" className="pc-b" aria-label={c.settings} aria-haspopup="menu" aria-expanded={panel !== null} onClick={() => setPanel(panel ? null : 'root')}><Settings aria-hidden="true" /></button>
          {s.canPip && <button type="button" className="pc-b pc-d" aria-label={c.pip} onClick={a.togglePip}><PictureInPicture2 aria-hidden="true" /></button>}
          <button type="button" className="pc-b pc-d" aria-label={c.theatre} aria-pressed={s.theatre} data-on={s.theatre} onClick={a.toggleTheatre}><RectangleHorizontal aria-hidden="true" /></button>
          <button type="button" className="pc-b" aria-label={s.full ? c.exitFull : c.full} onClick={a.toggleFull}>{s.full ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</button>
        </div>
      </div>
      {panel && (
        <div className="pc-menu" role="menu" dir={s.lang === 'ar' ? 'rtl' : 'ltr'}>
          {panel === 'root' && <>
            {s.qualities.length > 0 && row(c.quality, qLabel, 'quality')}
            {row(c.speed, s.rate === 1 ? c.normal : `${s.rate}×`, 'speed')}
            {s.captions.length > 0 && row(c.captions, capLabel, 'captions')}
            {s.audio.length > 1 && row(c.audio, s.audio.find((x) => x.id === s.audioId)?.label ?? '', 'audio')}
            <button type="button" className="pc-mi" onClick={() => { setPanel(null); a.shortcuts(); }}><Keyboard aria-hidden="true" /><span>{c.shortcuts}</span></button>
          </>}
          {panel === 'quality' && list(c.quality, s.qualities, s.quality, a.setQuality)}
          {panel === 'speed' && list(c.speed, RATES.map((r) => ({ id: String(r), label: r === 1 ? c.normal : `${r}×` })), String(s.rate), (id) => a.setRate(Number(id)))}
          {panel === 'captions' && list(c.captions, s.captions, s.caption, a.setCaption)}
          {panel === 'audio' && list(c.audio, s.audio, s.audioId, a.setAudio)}
        </div>
      )}
    </div>
  );
}
