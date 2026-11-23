/**
 * While a caption cue with Quran Foundation text is on screen, the player shows QF's short credit as
 * a link next to the captions (QF 2026-11-23; lib/video/quran-credit.ts). This hook takes the credit
 * line off the cues as tracks load (re-rendering the captions when a shown cue changed), and says
 * whether a credited cue is showing now. The player element gets `vjs-fanous-caption-credit` meanwhile,
 * which lifts the captions a row so the credit sits under them.
 */
'use client';

import { useEffect, useState } from 'react';
import { activeCueCredited, liftQuranCredits, showingCaptionTrack, type CreditTrackLike } from '@/lib/video/quran-credit';

type Listener = () => void;
interface EventTargetLike {
  addEventListener?(type: string, fn: Listener): void;
  removeEventListener?(type: string, fn: Listener): void;
}
type TrackLike = CreditTrackLike & EventTargetLike;
type TrackListLike = ArrayLike<TrackLike> & EventTargetLike;

export interface CreditPlayerLike {
  textTracks?(): TrackListLike | null | undefined;
  getChild?(name: string): { updateDisplay?(): void } | undefined | null;
  addClass?(name: string): void;
  removeClass?(name: string): void;
}

export const CAPTION_CREDIT_CLASS = 'vjs-fanous-caption-credit';

export function useQuranCaptionCredit(player: CreditPlayerLike | null | undefined, ready: boolean): boolean {
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    if (!ready || !player?.textTracks) return;
    const list = player.textTracks();
    if (!list) return;
    const bound = new Set<TrackLike>();

    const update: Listener = () => {
      let redraw = false;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t && liftQuranCredits(t) && t.mode === 'showing') redraw = true;
      }
      // Video.js drew the cue before its credit came off: draw it again without
      if (redraw) (player.getChild?.('textTrackDisplay') ?? player.getChild?.('TextTrackDisplay'))?.updateDisplay?.();
      const on = activeCueCredited(showingCaptionTrack(list));
      if (on) player.addClass?.(CAPTION_CREDIT_CLASS);
      else player.removeClass?.(CAPTION_CREDIT_CLASS);
      setShowing(on);
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

    bind();
    list.addEventListener?.('addtrack', bind);
    list.addEventListener?.('change', update);
    return () => {
      list.removeEventListener?.('addtrack', bind);
      list.removeEventListener?.('change', update);
      for (const t of bound) {
        t.removeEventListener?.('loadeddata', update);
        t.removeEventListener?.('cuechange', update);
      }
      player.removeClass?.(CAPTION_CREDIT_CLASS);
      setShowing(false);
    };
  }, [player, ready]);

  return showing;
}
