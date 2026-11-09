'use client';
/**
 * Overlays the player draws over the video (docs/specs/VIDEO-PLAYER.md section 5): the ended
 * state with up next, and the mini player's close and return buttons.
 *
 * End screen (the theme-demo design agent's spec, from the owner's review): one blurred, tinted
 * scrim over the last frame; a centred block with a muted "Up next" above a two-column card, the
 * thumbnail beside a text column of the same height whose title meets the thumbnail's top and whose
 * buttons meet its bottom. Play now carries the countdown ring with the seconds left.
 *
 * The countdown starts when the video ends and plays the next video at zero. It pauses while the
 * pointer is over the card or focus arrives there from anywhere but our own initial focus, and any
 * key or press stops it; Escape and Cancel stop it and leave the screen in place. It is announced
 * once. Focus moves to Play now only when it was on the page body or inside this player, so a viewer
 * typing elsewhere on the page keeps their place.
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Maximize2, Play, RotateCcw, SkipForward, X } from 'lucide-react';
import type { UpNext } from '@/lib/video/player-ui';
import type { VideoPlayerTranslations } from '@/lib/video/i18n/types';

/** Seconds before the next video starts on its own */
export const AUTO_ADVANCE_SECONDS = 8;
const RING_RADIUS = 9;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

interface EndScreenProps {
  upNext: UpNext | null;
  onReplay: () => void;
  t: VideoPlayerTranslations;
  dir: 'ltr' | 'rtl';
  /** Seconds before advancing; 0 turns auto-advance off */
  autoAdvanceSeconds?: number;
}

export function EndScreen({ upNext, onReplay, t, dir, autoAdvanceSeconds = AUTO_ADVANCE_SECONDS }: EndScreenProps) {
  const [elapsed, setElapsed] = useState(0);
  const [stopped, setStopped] = useState(autoAdvanceSeconds <= 0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const ownFocus = useRef(false);
  const goRef = useRef(upNext?.go);
  goRef.current = upNext?.go;
  const counting = !!upNext && !stopped;
  const ticking = counting && !hovered && !focused;

  // Focus Play now, unless the viewer is working somewhere else on the page
  useEffect(() => {
    const root = rootRef.current;
    const target = playRef.current ?? root?.querySelector<HTMLButtonElement>('button');
    if (!root || !target) return;
    const active = document.activeElement;
    const player = root.closest('.video-js');
    if (active && active !== document.body && !(player && player.contains(active))) return;
    ownFocus.current = true;
    target.focus({ preventScroll: true });
    ownFocus.current = false;
    // The pointer may already rest on the card when the video ends
    setHovered(!!root.querySelector('.vjs-fanous-next-card:hover'));
  }, []);

  // Counts only while the tab is visible, so a background tab does not skip a video unseen
  useEffect(() => {
    if (!ticking) return undefined;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      // Taken now: React may run the updater after `last` has moved on
      const step = (now - last) / 1000;
      last = now;
      if (!document.hidden) setElapsed((e) => e + step);
    }, 100);
    return () => window.clearInterval(id);
  }, [ticking]);

  useEffect(() => {
    // Summed 100ms steps land a hair under whole seconds
    if (counting && elapsed >= autoAdvanceSeconds - 1e-6) {
      setStopped(true);
      goRef.current?.();
    }
  }, [counting, elapsed, autoAdvanceSeconds]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (MODIFIERS.has(e.key)) return;
    if (e.key === 'Escape' && counting) e.stopPropagation();
    setStopped(true);
  };
  const onFocus = () => {
    if (!ownFocus.current) setFocused(true);
  };
  const onBlur = (e: FocusEvent) => {
    if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
  };

  if (!upNext) {
    return (
      <div ref={rootRef} className="vjs-fanous-end vjs-fanous-end-replay" dir={dir} data-testid="player-end-screen">
        <button type="button" className="vjs-fanous-btn vjs-fanous-btn-primary" onClick={onReplay} data-testid="player-replay">
          <RotateCcw aria-hidden="true" />
          <span className="vjs-fanous-btn-label">{t.chrome.watchAgain}</span>
        </button>
      </div>
    );
  }

  const remaining = Math.max(0, Math.ceil(autoAdvanceSeconds - elapsed));
  const progress = Math.min(1, elapsed / autoAdvanceSeconds);

  return (
    <div
      ref={rootRef}
      className="vjs-fanous-end"
      dir={dir}
      data-testid="player-end-screen"
      data-counting={counting ? '' : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={() => setStopped(true)}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="vjs-fanous-next-card" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
        <p className="vjs-fanous-next-kicker">{t.chrome.upNext}</p>
        <button
          type="button"
          className="vjs-fanous-next-thumb"
          aria-label={t.chrome.playTitle.replace('{title}', upNext.title)}
          onClick={upNext.go}
          data-testid="player-next-thumb"
          style={upNext.thumbnail ? { backgroundImage: `url(${JSON.stringify(upNext.thumbnail)})` } : undefined}
        >
          <span className="vjs-fanous-next-thumb-play" aria-hidden="true">
            <Play />
          </span>
        </button>
        <div className="vjs-fanous-next-text">
          <div className="vjs-fanous-next-meta">
            <p className="vjs-fanous-next-title">{upNext.title}</p>
            <p className="vjs-fanous-next-channel">{upNext.channel}</p>
          </div>
          <div className="vjs-fanous-next-actions">
            <button ref={playRef} type="button" className="vjs-fanous-btn vjs-fanous-btn-primary" onClick={upNext.go} data-testid="player-play-next">
              {counting ? (
                <span className="vjs-fanous-next-ring" data-testid="player-next-ring" aria-hidden="true">
                  <svg viewBox="0 0 22 22">
                    <circle className="vjs-fanous-next-ring-track" cx="11" cy="11" r={RING_RADIUS} />
                    <circle
                      className="vjs-fanous-next-ring-fill"
                      cx="11"
                      cy="11"
                      r={RING_RADIUS}
                      strokeDasharray={RING_LENGTH}
                      strokeDashoffset={RING_LENGTH * progress}
                    />
                  </svg>
                  <span className="vjs-fanous-next-count">{remaining}</span>
                </span>
              ) : (
                <SkipForward aria-hidden="true" className="vjs-fanous-icon-dir" />
              )}
              <span className="vjs-fanous-btn-label">{t.chrome.playNow}</span>
            </button>
            <button type="button" className="vjs-fanous-btn vjs-fanous-btn-secondary" onClick={() => { setStopped(true); onReplay(); }} data-testid="player-watch-again">
              <RotateCcw aria-hidden="true" />
              <span className="vjs-fanous-btn-label">{t.chrome.watchAgain}</span>
            </button>
            {counting && (
              <button type="button" className="vjs-fanous-btn vjs-fanous-btn-ghost" onClick={() => setStopped(true)} data-testid="player-cancel-next">
                <X aria-hidden="true" />
                <span className="vjs-fanous-btn-label">{t.chrome.cancel}</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Announced once, not every second */}
      <p className="vjs-control-text" role="status" aria-live="polite">
        {counting ? t.chrome.autoAdvance.replace('{seconds}', String(autoAdvanceSeconds)) : ''}
      </p>
    </div>
  );
}

export function MiniPlayerButtons({ onClose, onReturn, t }: { onClose: () => void; onReturn: () => void; t: VideoPlayerTranslations }) {
  return (
    <div className="vjs-fanous-mini-actions">
      <button type="button" className="vjs-fanous-mini-btn" aria-label={t.chrome.backToVideo} onClick={onReturn} data-testid="player-mini-return">
        <Maximize2 aria-hidden="true" />
      </button>
      <button type="button" className="vjs-fanous-mini-btn" aria-label={t.chrome.closeMiniPlayer} onClick={onClose} data-testid="player-mini-close">
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
