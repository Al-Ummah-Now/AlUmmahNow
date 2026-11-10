'use client';
/**
 * The player's settings panel (docs/specs/VIDEO-PLAYER.md section 5): quality, speed, captions,
 * audio track and keyboard shortcuts in one menu above the gear. Portalled to the player layer (the
 * body, or the fullscreen element; lib/video/player-layer.ts) so page content never draws over it,
 * and placed in viewport coordinates over the frame: end-aligned with the gear, 8px above the whole
 * bar including the progress bar, never taller than the frame above the bar. It keeps the controls
 * awake while open.
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Player } from 'video.js';
import { AudioLines, Captions, Check, ChevronLeft, ChevronRight, Gauge, Keyboard, SlidersHorizontal, Type, type LucideIcon } from 'lucide-react';
import { SETTINGS_TOGGLE_EVENT } from '@/lib/video/components';
import { PLAYER_LAYER_ATTR } from '@/lib/video/player-layer';
import { isLivePlayback } from '@/lib/video/live-state';
import { usePlayerLayerHost } from './usePlayerLayerHost';
import { useVideoPlayerI18n, type SupportedLanguage } from '@/lib/video/i18n';
import {
  audioOptions,
  captionOptions,
  currentAudioId,
  currentCaptionId,
  currentQualityId,
  menuKeyAction,
  moveIndex,
  qualityOptions,
  qualityValue,
  rootRows,
  selectAudio,
  selectCaption,
  selectQuality,
  speedLabel,
  speedOptions,
  type AudioTrackLike,
  type MenuOption,
  type PanelId,
  type QualityLevelLike,
  type TextTrackLike,
} from '@/lib/video/settings-model';

interface Levels extends ArrayLike<QualityLevelLike> {
  selectedIndex: number;
  on(e: string, f: () => void): void;
  off(e: string, f: () => void): void;
}
type Tracks<T> = ArrayLike<T> & { addEventListener?(e: string, f: () => void): void; removeEventListener?(e: string, f: () => void): void };
interface PlayerApi {
  el(): HTMLElement;
  on(e: string, f: () => void): void;
  off(e: string, f: () => void): void;
  addClass(c: string): void;
  removeClass(c: string): void;
  userActive(v?: boolean): boolean;
  options_: { inactivityTimeout?: number; playbackRates?: number[] };
  qualityLevels?(): Levels;
  textTracks?(): Tracks<TextTrackLike>;
  audioTracks?(): Tracks<AudioTrackLike>;
  playbackRate(): number;
  playbackRate(r: number): void;
  getChild(name: string): { open?(): void } | undefined;
  liveTracker?: { isLive(): boolean };
  duration(): number;
}

const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** The leading icon of each root row: every row is [icon] label ... value > */
/** Settings rows are a fixed 44px (docs/specs/VIDEO-PLAYER.md, Settings menu) */
const ROW_HEIGHT = 44;
/** Below this many rows of room above the bar, the panel covers the bar instead */
const MIN_ROWS_ABOVE_BAR = 3;
/** Frames narrower than this (phones) are small players: the panel fills the frame */
const SMALL_FRAME_WIDTH = 480;

const ROW_ICONS: Record<'quality' | 'speed' | 'captions' | 'audio' | 'shortcuts', LucideIcon> = {
  quality: SlidersHorizontal,
  speed: Gauge,
  captions: Captions,
  audio: AudioLines,
  shortcuts: Keyboard,
};

/**
 * A value as text, with any Latin run in brackets ("Auto (720p)") isolated left to right: in an
 * Arabic row the brackets otherwise resolve right to left and some fonts mirror only one of them,
 * which drew "(720p( تلقائي".
 */
function valueText(value: string) {
  const m = value.match(/^(.*?)(\s*)(\([\x20-\x7E]*\))$/);
  if (!m) return value;
  return <>{m[1]}{m[2]}<bdi dir="ltr">{m[3]}</bdi></>;
}

export interface SettingsMenuProps {
  player: Player;
  lang: SupportedLanguage;
  onShowShortcuts: () => void;
}

export function SettingsMenu({ player, lang, onShowShortcuts }: SettingsMenuProps) {
  const p = player as unknown as PlayerApi;
  const { t, dir } = useVideoPlayerI18n(lang);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PanelId>('root');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const menuRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const focusAfterRef = useRef<string | null>(null);
  const savedTimeoutRef = useRef<number | undefined>(undefined);
  const host = usePlayerLayerHost(p.el?.());

  const gear = useCallback(() => p.el()?.querySelector<HTMLElement>('.vjs-fanous-settings'), [p]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPanel('root');
    if (refocus) gear()?.focus();
  }, [gear]);

  // Gear clicks toggle the panel
  useEffect(() => {
    const toggle = () => setOpen((o) => {
      if (!o) { setPanel('root'); focusAfterRef.current = 'first'; }
      return !o;
    });
    p.on(SETTINGS_TOGGLE_EVENT, toggle);
    return () => p.off(SETTINGS_TOGGLE_EVENT, toggle);
  }, [p]);

  // Live values: re-render when anything the rows show changes
  useEffect(() => {
    const events = ['ratechange', 'loadedmetadata', 'durationchange'];
    events.forEach((e) => p.on(e, refresh));
    const levels = p.qualityLevels?.();
    ['change', 'addqualitylevel', 'removequalitylevel'].forEach((e) => levels?.on(e, refresh));
    const text = p.textTracks?.();
    const audio = p.audioTracks?.();
    ['change', 'addtrack', 'removetrack'].forEach((e) => { text?.addEventListener?.(e, refresh); audio?.addEventListener?.(e, refresh); });
    return () => {
      events.forEach((e) => p.off(e, refresh));
      ['change', 'addqualitylevel', 'removequalitylevel'].forEach((e) => levels?.off(e, refresh));
      ['change', 'addtrack', 'removetrack'].forEach((e) => { text?.removeEventListener?.(e, refresh); audio?.removeEventListener?.(e, refresh); });
    };
  }, [p]);

  // While open: the gear says so, and the controls stay up
  useEffect(() => {
    gear()?.setAttribute('aria-expanded', String(open));
    if (!open) return;
    p.addClass('vjs-menu-open');
    savedTimeoutRef.current = p.options_.inactivityTimeout;
    p.options_.inactivityTimeout = 0;
    p.userActive(true);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || gear()?.contains(target)) return;
      close(false);
      // A press on the video only dismisses the menu: swallow the click that follows, or
      // Video.js would also toggle playback
      if (p.el()?.contains(target) && !(target as Element).closest?.('.vjs-control-bar')) {
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener('click', swallow, { capture: true, once: true });
        // A press that never becomes a click (drag, cancelled touch) must not eat a later click
        window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 600);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      p.removeClass('vjs-menu-open');
      p.options_.inactivityTimeout = savedTimeoutRef.current;
      p.userActive(true);
    };
  }, [open, p, gear, close]);

  // Fit inside the frame above the bar, and grow or shrink to each view's content
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const view = viewRef.current;
    if (!open || !menu || !view) return;
    const fit = () => {
      const frameEl = p.el();
      const frame = frameEl.getBoundingClientRect();
      const bar = frameEl.querySelector<HTMLElement>('.vjs-control-bar');
      const barH = bar?.offsetHeight ?? 0;
      const viewportW = document.documentElement.clientWidth;
      const viewportH = window.innerHeight;
      // The panel is border-box: its height includes its padding and border around the view
      const cs = getComputedStyle(menu);
      const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, k) => sum + (parseFloat(cs[k as 'paddingTop']) || 0), 0);
      // Above the bar when the player is wide enough and three rows fit there. A small player (a
      // phone-width frame, or one too short for three rows above its bar) gets the whole frame,
      // 8px in from every edge, over the controls: one clean surface with every row in reach,
      // never a 280px box half over the progress bar with the controls peeking out beside it.
      const above = frame.height - barH - 16;
      const over = frame.width < SMALL_FRAME_WIDTH || above < MIN_ROWS_ABOVE_BAR * ROW_HEIGHT + chrome;
      const inset = over || frame.width < 360 ? 8 : 12;
      menu.style.width = `${over ? Math.max(0, frame.width - 16) : Math.max(160, Math.min(280, frame.width - 16))}px`;
      menu.style.right = `${viewportW - frame.right + inset}px`;
      // The panel is fixed to the viewport: when the top of the frame is scrolled out of view it
      // only gets the room on screen above its anchor (8px clear of the viewport's top edge).
      // Sized to the frame, its top rows sat above the viewport, out of reach, and a click on one
      // scrolled the page, which moved the panel again, so it never settled.
      const anchor = (over ? frame.bottom : frame.bottom - barH) - 8;
      const room = Math.max(0, Math.min(over ? frame.height - 16 : above, anchor - 8));
      menu.toggleAttribute('data-over-bar', over);
      menu.style.bottom = `${viewportH - anchor}px`;
      menu.style.maxHeight = `${room}px`;
      // A small player's panel is the whole frame whatever the view holds (Safari, playing HLS
      // natively, has no Quality row), so it never leaves a strip of controls showing above it
      menu.style.height = `${over ? room : Math.min(room, view.scrollHeight + chrome)}px`;
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(p.el());
    ro?.observe(view);
    // The frame moves with the page; the panel is fixed to the viewport, so it follows
    window.addEventListener('scroll', fit, { capture: true, passive: true });
    window.addEventListener('resize', fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener('scroll', fit, { capture: true });
      window.removeEventListener('resize', fit);
    };
  }, [open, panel, p, host]);

  // Focus moves only on open and on changing view, never on a live refresh (ABR switches
  // re-render the Quality row): the first row on open, the checked option in a submenu, and
  // the row we came from on going back.
  useLayoutEffect(() => {
    const want = focusAfterRef.current;
    if (!open || want === null) return;
    const items = items_();
    if (items.length === 0) return;
    focusAfterRef.current = null;
    const checked = items.findIndex((el) => el.getAttribute('aria-checked') === 'true');
    const target = items.find((el) => el.dataset.row === want) ?? items[panel === 'root' ? 0 : Math.max(0, checked)];
    target?.focus({ preventScroll: true });
  });

  function items_(): HTMLElement[] {
    return Array.from(viewRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  }

  if (!open || !host) return null;

  const levels = p.qualityLevels?.();
  const qualities = qualityOptions(levels, t.quality.auto);
  const qualityId = currentQualityId(levels);
  const playing = levels && levels.selectedIndex >= 0 ? levels[levels.selectedIndex]?.height : undefined;
  const live = isLivePlayback(p);
  const rates = p.options_.playbackRates?.length ? p.options_.playbackRates : DEFAULT_RATES;
  const text = p.textTracks?.();
  const captions = captionOptions(text, t.chrome.off);
  const captionId = currentCaptionId(text);
  const audio = audioOptions(p.audioTracks?.());
  const audioId = currentAudioId(p.audioTracks?.());
  const captionStyle = p.getChild('textTrackSettings') ?? p.getChild('TextTrackSettings');

  const rows = rootRows({
    labels: { quality: t.controls.quality, speed: t.controls.speed, captions: t.controls.captions, audio: t.chrome.audioTrack, shortcuts: t.chrome.shortcuts },
    quality: qualities.length ? qualityValue(qualityId, playing, t.quality.auto) : undefined,
    speed: live ? undefined : speedLabel(p.playbackRate(), t.speed.normal),
    captions: captions.length ? captions.find((o) => o.id === captionId)?.label : undefined,
    audio: audio.length ? audio.find((o) => o.id === audioId)?.label : undefined,
  });

  const go = (next: PanelId, from?: string) => {
    setDirection(next === 'root' ? 'back' : 'forward');
    focusAfterRef.current = from ?? 'default';
    setPanel(next);
  };
  const choose = (apply: () => void, from: PanelId) => {
    apply();
    refresh();
    go('root', from);
  };

  const sub = (title: string, options: MenuOption[], current: string, apply: (id: string) => void, extra?: { label: string; run: () => void }) => (
    <>
      <button type="button" role="menuitem" className="vjs-fanous-mi vjs-fanous-mi-back" data-row="back" tabIndex={-1} onClick={() => go('root', panel)}>
        <span className="vjs-fanous-mi-icon" aria-hidden="true">{dir === 'rtl' ? <ChevronRight /> : <ChevronLeft />}</span>
        <span className="vjs-fanous-mi-label">{title}</span>
      </button>
      <div role="group" aria-label={title}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="menuitemradio"
            aria-checked={o.id === current}
            className="vjs-fanous-mi vjs-fanous-mi-option"
            data-row={o.id}
            tabIndex={-1}
            onClick={() => choose(() => apply(o.id), panel)}
          >
            <span className="vjs-fanous-mi-icon vjs-fanous-mi-check" aria-hidden="true">{o.id === current && <Check />}</span>
            <span className="vjs-fanous-mi-label">{o.label}</span>
          </button>
        ))}
      </div>
      {extra && (
        <button type="button" role="menuitem" className="vjs-fanous-mi vjs-fanous-mi-extra" data-row="extra" tabIndex={-1} onClick={() => { close(false); extra.run(); }}>
          <span className="vjs-fanous-mi-icon" aria-hidden="true"><Type /></span>
          <span className="vjs-fanous-mi-label">{extra.label}</span>
        </button>
      )}
    </>
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const action = menuKeyAction(e.key, dir === 'rtl' ? 'rtl' : 'ltr', panel !== 'root');
    if (!action) return;
    e.preventDefault();
    const list = items_();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (action === 'next' || action === 'prev' || action === 'first' || action === 'last') {
      list[moveIndex(at, list.length, action)]?.focus();
    } else if (action === 'activate') {
      (document.activeElement as HTMLElement | null)?.click();
    } else if (action === 'open') {
      const el = list[at];
      if (el?.getAttribute('aria-haspopup') === 'menu') el.click();
    } else if (action === 'back') {
      go('root', panel);
    } else if (action === 'close') {
      close(true);
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="vjs-fanous-layer vjs-fanous-menu"
      {...{ [PLAYER_LAYER_ATTR]: '' }}
      role="menu"
      aria-label={t.controls.settings}
      dir={dir}
      data-panel={panel}
      data-testid="player-settings-menu"
      onKeyDown={onKeyDown}
    >
      <div ref={viewRef} key={panel} className="vjs-fanous-menu-view" data-direction={direction}>
        {panel === 'root' && rows.map((r) => (
          <button
            key={r.id}
            type="button"
            role="menuitem"
            className="vjs-fanous-mi vjs-fanous-mi-row"
            data-row={r.id}
            aria-haspopup={r.id === 'shortcuts' ? 'dialog' : 'menu'}
            tabIndex={-1}
            onClick={() => (r.id === 'shortcuts' ? (close(false), onShowShortcuts()) : go(r.id, undefined))}
          >
            <span className="vjs-fanous-mi-icon" aria-hidden="true">{createElement(ROW_ICONS[r.id])}</span>
            <span className="vjs-fanous-mi-label">{r.label}</span>
            {r.value !== undefined && <span className="vjs-fanous-mi-value">{valueText(r.value)}</span>}
            {r.id !== 'shortcuts' && <span className="vjs-fanous-mi-end" aria-hidden="true">{dir === 'rtl' ? <ChevronLeft /> : <ChevronRight />}</span>}
          </button>
        ))}
        {panel === 'quality' && sub(t.controls.quality, qualities, qualityId, (id) => selectQuality(levels, id))}
        {panel === 'speed' && sub(t.controls.speed, speedOptions(rates, t.speed.normal), String(p.playbackRate()), (id) => p.playbackRate(Number(id)))}
        {panel === 'captions' && sub(t.controls.captions, captions, captionId, (id) => selectCaption(text, id), captionStyle?.open ? { label: t.chrome.captionStyle, run: () => captionStyle.open?.() } : undefined)}
        {panel === 'audio' && sub(t.chrome.audioTrack, audio, audioId, (id) => selectAudio(p.audioTracks?.(), id))}
      </div>
    </div>,
    host,
  );
}
