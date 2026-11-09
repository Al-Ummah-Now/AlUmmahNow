'use client';
// Prototype only: connects the themed controls to the existing video.js engine.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Player } from 'video.js';
import { PlayerChromeView, PLAYER_COPY, type ChromeActions, type ChromeState, type Option } from './PlayerChromeView';
import { getDemoNext, subscribeDemoNext } from './demoNext';

type Level = { height?: number; enabled: boolean };
type Levels = { length: number; [i: number]: Level; selectedIndex: number; on(e: string, f: () => void): void; off(e: string, f: () => void): void };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ext = Player & { qualityLevels?: () => Levels; liveTracker?: { isLive(): boolean; liveCurrentTime(): number; seekToLiveEdge(): void }; userActive(): boolean; [k: string]: any };
type TT = { kind: string; label: string; language: string; mode: string; cues?: { length: number; [i: number]: { startTime: number } } | null };
const isTrackList = (x: unknown): TT[] => { const l = x as { length: number; [i: number]: TT }; return Array.from({ length: l?.length ?? 0 }, (_, i) => l[i]); };

export function PlayerChrome({ player, lang, onShortcuts }: { player: Player; lang: 'en' | 'ar'; onShortcuts: () => void }) {
  const p = player as unknown as Ext;
  const c = PLAYER_COPY[lang];
  const [, bump] = useState(0);
  const [theatre, setTheatre] = useState(false);
  const [mini, setMini] = useState(false);
  const started = useRef(false);
  const ended = useRef(false);
  const buffering = useRef(false);
  const auto = useRef(true);
  const manualQ = useRef('auto');
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const r = () => bump((n) => n + 1);
    const evts = ['timeupdate', 'progress', 'durationchange', 'volumechange', 'ratechange', 'fullscreenchange', 'useractive', 'userinactive', 'loadedmetadata', 'enterpictureinpicture', 'leavepictureinpicture'];
    evts.forEach((e) => p.on(e, r));
    const play = () => { started.current = true; ended.current = false; r(); }; const pause = () => r();
    const end = () => { ended.current = true; r(); };
    const wait = () => { buffering.current = true; r(); }; const ready = () => { buffering.current = false; r(); };
    p.on('play', play); p.on('pause', pause); p.on('ended', end); p.on('waiting', wait); p.on('playing', ready); p.on('canplay', ready);
    const ql = p.qualityLevels?.(); ql?.on('addqualitylevel', r);
    const tt = p.textTracks() as unknown as { addEventListener?: (e: string, f: () => void) => void; removeEventListener?: (e: string, f: () => void) => void };
    tt.addEventListener?.('change', r); tt.addEventListener?.('addtrack', r);
    const un = subscribeDemoNext(r);
    return () => { evts.forEach((e) => p.off(e, r)); p.off('play', play); p.off('pause', pause); p.off('ended', end); p.off('waiting', wait); p.off('playing', ready); p.off('canplay', ready); ql?.off('addqualitylevel', r); tt.removeEventListener?.('change', r); tt.removeEventListener?.('addtrack', r); un(); };
  }, [p]);

  useEffect(() => { document.documentElement.toggleAttribute('data-theatre', theatre); return () => document.documentElement.removeAttribute('data-theatre'); }, [theatre]);

  // Mini player: while playing and the frame scrolls away, float it in the corner.
  useEffect(() => {
    const el = root.current?.closest('.custom-video-player');
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setMini(!e.isIntersecting && !p.paused()), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [p]);
  useEffect(() => { root.current?.closest('.custom-video-player')?.toggleAttribute('data-mini', mini); }, [mini]);

  const levels = p.qualityLevels?.();
  const qualities = useMemo<Option[]>(() => [], []);
  qualities.length = 0;
  if (levels && levels.length > 1) {
    qualities.push({ id: 'auto', label: c.auto });
    for (let i = levels.length - 1; i >= 0; i--) if (levels[i].height) qualities.push({ id: String(i), label: `${levels[i].height}p` });
  }
  const tracks = isTrackList(p.textTracks());
  const subs = tracks.filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
  const showing = subs.findIndex((t) => t.mode === 'showing');
  const chTrack = tracks.find((t) => t.kind === 'chapters');
  const chapters: number[] = [];
  if (chTrack?.cues) for (let i = 1; i < chTrack.cues.length; i++) chapters.push(chTrack.cues[i].startTime);
  const dur = p.duration() || 0;
  const bufEnd = p.buffered().length ? p.buffered().end(p.buffered().length - 1) : 0;
  const live = !!p.liveTracker?.isLive();
  const next = getDemoNext();

  const s: ChromeState = {
    lang, playing: !p.paused(), started: started.current, time: p.currentTime() || 0, duration: dur, buffered: dur ? Math.min(100, (bufEnd / dur) * 100) : 0,
    volume: p.volume() ?? 1, muted: !!p.muted(), buffering: buffering.current && started.current, ended: ended.current, active: p.userActive(), full: !!p.isFullscreen(), theatre,
    live, behindLive: live && p.liveTracker ? Math.max(0, p.liveTracker.liveCurrentTime() - (p.currentTime() || 0)) : 0, chapters, hasNext: !!next,
    qualities, quality: manualQ.current, rate: p.playbackRate() ?? 1,
    captions: subs.length ? [{ id: 'off', label: c.off }, ...subs.map((t, i) => ({ id: String(i), label: t.label || t.language }))] : [], caption: showing >= 0 ? String(showing) : 'off',
    audio: [], audioId: '', canPip: typeof document !== 'undefined' && !!document.pictureInPictureEnabled, next: next ?? undefined,
  };
  void auto;
  const a: ChromeActions = {
    toggle: () => { if (p.paused()) void p.play(); else p.pause(); },
    seek: (t) => { p.currentTime(Math.max(0, Math.min(dur, t))); },
    setVolume: (v) => { p.volume(v); p.muted(v === 0); }, toggleMute: () => p.muted(!p.muted()),
    onNext: () => { if (next?.href) window.location.href = next.href; },
    toggleFull: () => { if (p.isFullscreen()) void p.exitFullscreen(); else void p.requestFullscreen(); },
    toggleTheatre: () => setTheatre((t) => !t),
    togglePip: () => { if (document.pictureInPictureElement) void document.exitPictureInPicture(); else void p.requestPictureInPicture?.(); },
    setQuality: (id) => { manualQ.current = id; const l = p.qualityLevels?.(); if (l) for (let i = 0; i < l.length; i++) l[i].enabled = id === 'auto' || String(i) === id; bump((n) => n + 1); },
    setRate: (r) => p.playbackRate(r),
    setCaption: (id) => { subs.forEach((t, i) => { t.mode = String(i) === id ? 'showing' : 'disabled'; }); bump((n) => n + 1); },
    setAudio: () => undefined, shortcuts: onShortcuts,
    replay: () => { p.currentTime(0); void p.play(); }, goLive: () => p.liveTracker?.seekToLiveEdge(),
  };
  return <div ref={root} className="pc-host"><PlayerChromeView s={s} a={a} />{mini && <button type="button" className="pc-mini-x" aria-label="×" onClick={() => { p.pause(); setMini(false); }}>×</button>}</div>;
}
