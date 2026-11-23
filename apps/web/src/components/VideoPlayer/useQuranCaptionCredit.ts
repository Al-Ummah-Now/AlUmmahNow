/**
 * While a caption cue with Quran Foundation text is on screen, the player shows QF's short credit as
 * a link directly under the cue (QF 2026-11-23; lib/video/quran-credit.ts; wiki AUN-PLAYER-LINKS
 * §6.2, phase 0). This hook:
 * - takes the credit line off the cues as tracks load, re-rendering the captions when a shown cue
 *   changed;
 * - says whether a credited cue is showing now, and in which language (the credit follows the cue's
 *   language and direction, not the page's);
 * - measures the cue's box so the credit sits under it at the cue's end side, at 70% of the cue's
 *   text size (at least 11px), in the cue's colours (the viewer's Caption style included). The values
 *   go on the player element as CSS custom properties.
 * Meanwhile the player element has `vjs-fanous-caption-credit`, which lifts the captions a row.
 */
'use client';

import { useEffect, useState } from 'react';
import { RTL_CAPTION_LANGUAGES } from '@al-ummah/shared-types';
import { activeCueCredited, liftQuranCredits, showingCaptionTrack, type CreditTrackLike } from '@/lib/video/quran-credit';

type Listener = () => void;
interface EventTargetLike {
  addEventListener?(type: string, fn: Listener): void;
  removeEventListener?(type: string, fn: Listener): void;
}
type TrackLike = CreditTrackLike & EventTargetLike & { language?: string };
type TrackListLike = ArrayLike<TrackLike> & EventTargetLike;

export interface CreditPlayerLike {
  el?(): HTMLElement | null;
  textTracks?(): TrackListLike | null | undefined;
  getChild?(name: string): { updateDisplay?(): void } | undefined | null;
  addClass?(name: string): void;
  removeClass?(name: string): void;
  on?(event: string | string[], fn: Listener): void;
  off?(event: string | string[], fn: Listener): void;
}

export interface CaptionCredit {
  showing: boolean;
  /** The shown track's language (the credit's language) */
  language: string;
  dir: 'ltr' | 'rtl';
}

export const CAPTION_CREDIT_CLASS = 'vjs-fanous-caption-credit';
const OFF: CaptionCredit = { showing: false, language: 'en', dir: 'ltr' };
const RESIZE_EVENTS = ['playerresize', 'fullscreenchange', 'resize'];

export const captionDir = (language: string): 'ltr' | 'rtl' => (RTL_CAPTION_LANGUAGES.has(language.split('-')[0]!.toLowerCase()) ? 'rtl' : 'ltr');

/**
 * Places the credit under the lowest cue box on screen: its end edge (in the cue's direction) at
 * the cue box's end edge, its size 70% of the cue text (at least 11px), in the cue's colours.
 */
export function placeCredit(playerEl: HTMLElement, dir: 'ltr' | 'rtl'): void {
  const boxes = Array.from(playerEl.querySelectorAll<HTMLElement>('.vjs-text-track-display .vjs-text-track-cue > div'));
  const box = boxes.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
  if (!box) return;
  const frame = playerEl.getBoundingClientRect();
  const r = box.getBoundingClientRect();
  if (!frame.width || !r.width) return;
  const end = dir === 'rtl' ? r.left - frame.left : frame.right - r.right;
  const css = getComputedStyle(box);
  const size = Math.max(11, Math.round(parseFloat(css.fontSize || '16') * 0.7));
  playerEl.style.setProperty('--fanous-credit-end', `${Math.max(6, Math.round(end))}px`);
  playerEl.style.setProperty('--fanous-credit-size', `${size}px`);
  // The row the captions move up by: the credit's line box (1.5) and padding plus a 2px gap, less the
  // margin Video.js already leaves under the cues (1.5% of the caption box)
  const inset = parseFloat(box.parentElement?.parentElement ? getComputedStyle(box.parentElement.parentElement).marginBottom : '0') || 0;
  playerEl.style.setProperty('--fanous-link-row', `${Math.max(0, Math.ceil(size * 1.5) + 4 - Math.round(inset))}px`);
  if (css.color) playerEl.style.setProperty('--fanous-credit-color', css.color);
  if (css.backgroundColor) playerEl.style.setProperty('--fanous-credit-bg', css.backgroundColor);
}

export function useQuranCaptionCredit(player: CreditPlayerLike | null | undefined, ready: boolean): CaptionCredit {
  const [credit, setCredit] = useState<CaptionCredit>(OFF);

  useEffect(() => {
    if (!ready || !player?.textTracks) return;
    const list = player.textTracks();
    if (!list) return;
    const bound = new Set<TrackLike>();
    let frame = 0;
    let shown = false;

    const measure = (dir: 'ltr' | 'rtl') => {
      cancelAnimationFrame(frame);
      // After Video.js has drawn the cue
      frame = requestAnimationFrame(() => {
        const el = player.el?.();
        if (el) placeCredit(el, dir);
      });
    };

    const update: Listener = () => {
      let redraw = false;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t && liftQuranCredits(t) && t.mode === 'showing') redraw = true;
      }
      const track = showingCaptionTrack(list);
      const on = activeCueCredited(track);
      const language = track?.language || 'en';
      const dir = captionDir(language);
      if (on) player.addClass?.(CAPTION_CREDIT_CLASS);
      else player.removeClass?.(CAPTION_CREDIT_CLASS);
      // Draw the cues again when one lost its credit line after Video.js drew it, and whenever the
      // credit shows: the caption box just moved up a row (Video.js lays cues out only when it draws
      // them), and a cue reached by seeking while paused is otherwise left as it was
      if (redraw || on || on !== shown) (player.getChild?.('textTrackDisplay') ?? player.getChild?.('TextTrackDisplay'))?.updateDisplay?.();
      shown = on;
      if (on) measure(dir);
      setCredit((prev) => (prev.showing === on && prev.language === language && prev.dir === dir ? prev : { showing: on, language, dir }));
    };
    const bind: Listener = () => {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t || bound.has(t)) continue;
        bound.add(t);
        t.addEventListener?.('loadeddata', update);
        t.addEventListener?.('cuechange', update);
      }
      update();
    };

    // The caption box moves with the controls (88px or 16px, plus the credit row) over 200 ms. Video.js
    // lays cues out in pixels when it draws them, so a cue drawn mid-move (a seek or a credit row that
    // came or went while the controls were showing or hiding) would keep the old box's position and could
    // sit over the controls. Once the move has ended, the shown cues are drawn again in the box as it is.
    const displayEl = player.el?.()?.querySelector<HTMLElement>('.vjs-text-track-display') ?? null;
    const settled = (e: TransitionEvent) => {
      if (e.target !== displayEl || e.propertyName !== 'bottom' || !showingCaptionTrack(list)) return;
      (player.getChild?.('textTrackDisplay') ?? player.getChild?.('TextTrackDisplay'))?.updateDisplay?.();
      if (shown) measure(captionDir(showingCaptionTrack(list)?.language || 'en'));
    };

    bind();
    list.addEventListener?.('addtrack', bind);
    list.addEventListener?.('change', update);
    player.on?.(RESIZE_EVENTS, update);
    displayEl?.addEventListener('transitionend', settled);
    return () => {
      cancelAnimationFrame(frame);
      displayEl?.removeEventListener('transitionend', settled);
      list.removeEventListener?.('addtrack', bind);
      list.removeEventListener?.('change', update);
      player.off?.(RESIZE_EVENTS, update);
      for (const t of bound) {
        t.removeEventListener?.('loadeddata', update);
        t.removeEventListener?.('cuechange', update);
      }
      player.removeClass?.(CAPTION_CREDIT_CLASS);
      setCredit(OFF);
    };
  }, [player, ready]);

  return credit;
}
