'use client';
/**
 * The progress bar's hover tooltip (docs/specs/VIDEO-PLAYER.md section 5, Layers): the time under
 * the pointer and, when the video has chapters, the chapter there. It replaces Video.js's time
 * tooltip and the chapter markers' own tips, and is portalled to the player layer so the page
 * never draws over it. It follows the pointer along the bar (and keeps following while scrubbing),
 * stays inside the frame's width, and sits 10px above the progress bar.
 *
 * The bar runs left to right in both languages, so the time is the pointer's share of the bar from
 * the left. On live streams the time reads as the distance behind the live edge.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Player } from 'video.js';
import { formatTime } from '@/lib/video/progress-preview';
import { getPlayerUi, subscribePlayerUi, type ChapterTip } from '@/lib/video/player-ui';
import { PLAYER_LAYER_ATTR } from '@/lib/video/player-layer';
import { isLivePlayback } from '@/lib/video/live-state';
import { usePlayerLayerHost } from './usePlayerLayerHost';

const EDGE = 4;
const GAP = 10;

interface TipState {
  /** Pointer x in viewport pixels */
  x: number;
  time: number;
  live: boolean;
  behind: number;
}

/** The chapter that contains a time, from chapters sorted by start */
export function chapterAt(chapters: ChapterTip[], time: number): ChapterTip | null {
  let found: ChapterTip | null = null;
  for (const c of chapters) {
    if (c.startTime <= time) found = c;
    else break;
  }
  return found;
}

interface PlayerLike {
  el?(): HTMLElement | null;
  duration(): number;
  seekable(): TimeRanges;
  liveTracker?: { isLive(): boolean };
  scrubbing(): boolean;
}

export function ProgressTooltip({ player, dir }: { player: Player; dir: 'ltr' | 'rtl' }) {
  const p = player as unknown as PlayerLike;
  const host = usePlayerLayerHost(p.el?.());
  const [tip, setTip] = useState<TipState | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const chapters = useSyncExternalStore(subscribePlayerUi, () => getPlayerUi().chapters, () => getPlayerUi().chapters);

  useEffect(() => {
    const root = p.el?.();
    const control = root?.querySelector<HTMLElement>('.vjs-progress-control');
    const holder = root?.querySelector<HTMLElement>('.vjs-progress-holder');
    if (!control || !holder) return undefined;
    let inside = false;

    const show = (clientX: number) => {
      const bar = holder.getBoundingClientRect();
      if (bar.width <= 0) return;
      const share = Math.min(1, Math.max(0, (clientX - bar.left) / bar.width));
      const live = isLivePlayback(p);
      if (live) {
        const range = p.seekable();
        if (!range.length) return;
        const start = range.start(0);
        const end = range.end(range.length - 1);
        const time = start + share * (end - start);
        setTip({ x: clientX, time, live, behind: Math.max(0, end - time) });
        return;
      }
      const duration = p.duration();
      if (!Number.isFinite(duration) || duration <= 0) return;
      setTip({ x: Math.min(bar.right, Math.max(bar.left, clientX)), time: share * duration, live, behind: 0 });
    };
    const onMove = (e: PointerEvent) => show(e.clientX);
    const onEnter = (e: PointerEvent) => {
      inside = true;
      show(e.clientX);
    };
    const onLeave = () => {
      inside = false;
      if (!p.scrubbing()) setTip(null);
    };
    // While scrubbing the pointer may leave the bar; keep following it until release
    const onDocMove = (e: PointerEvent) => {
      if (!inside && p.scrubbing()) show(e.clientX);
    };
    const onUp = () => {
      if (!inside) setTip(null);
    };
    control.addEventListener('pointerenter', onEnter);
    control.addEventListener('pointermove', onMove);
    control.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointermove', onDocMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      control.removeEventListener('pointerenter', onEnter);
      control.removeEventListener('pointermove', onMove);
      control.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointermove', onDocMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [p]);

  // Above the progress bar, centred on the pointer, kept inside the frame's width
  useLayoutEffect(() => {
    const el = tipRef.current;
    const root = p.el?.();
    if (!tip || !el || !root) return;
    const frame = root.getBoundingClientRect();
    const holder = root.querySelector<HTMLElement>('.vjs-progress-holder')?.getBoundingClientRect();
    if (!holder) return;
    const half = el.offsetWidth / 2;
    const x = Math.min(frame.right - EDGE - half, Math.max(frame.left + EDGE + half, tip.x));
    el.style.left = `${x - half}px`;
    el.style.top = `${holder.top - GAP - el.offsetHeight}px`;
  });

  if (!tip || !host) return null;
  const chapter = tip.live ? null : chapterAt(chapters, tip.time);

  return createPortal(
    <div
      ref={tipRef}
      className="vjs-fanous-layer vjs-fanous-tip"
      role="tooltip"
      dir={dir}
      data-testid="player-progress-tooltip"
      {...{ [PLAYER_LAYER_ATTR]: '' }}
    >
      {chapter && <span className="vjs-fanous-tip-chapter">{chapter.title}</span>}
      <span className="vjs-fanous-tip-time" dir="ltr">{tip.live ? `-${formatTime(tip.behind)}` : formatTime(tip.time)}</span>
    </div>,
    host,
  );
}
