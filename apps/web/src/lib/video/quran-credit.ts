/**
 * Quran Foundation's short credit in the web player (QF 2026-11-23: "Next to the captions, a short
 * credit such as 'Source: Quran Foundation', linked to https://quran.foundation/, is enough").
 *
 * Served caption cues that show QF text end with the credit as a text line, so every player shows it
 * (native apps, other players). The web player can link: it takes that line off the cue (the caption
 * text is otherwise untouched) and shows the credit as a link next to the captions while such a cue
 * is on screen (PlayerLinkOverlay), and in the captions menu while the shown track has QF text.
 */
import { splitQuranCredit } from '@al-ummah/shared-types';

/** The few TextTrack members used here (Video.js's emulated tracks and native ones both have them). */
export interface CreditTrackLike {
  kind?: string;
  mode?: string;
  cues?: ArrayLike<{ text?: string }> | null;
  activeCues?: ArrayLike<{ text?: string }> | null;
}

/** Cues whose credit line was taken off (the cue objects themselves, so nothing leaks between videos). */
const credited = new WeakSet<object>();
/** Tracks with at least one credited cue. */
const creditedTracks = new WeakSet<object>();

/**
 * Takes the credit line off every loaded cue of `track` (each cue once) and remembers which cues had
 * it. Returns true when a cue changed, so the caller re-renders the caption display.
 */
export function liftQuranCredits(track: CreditTrackLike): boolean {
  const cues = track.cues;
  if (!cues) return false;
  let changed = false;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i] as { text?: string } | undefined;
    if (!cue || credited.has(cue) || typeof cue.text !== 'string') continue;
    const { text, credited: had } = splitQuranCredit(cue.text);
    if (!had) continue;
    cue.text = text;
    credited.add(cue);
    creditedTracks.add(track);
    changed = true;
  }
  return changed;
}

/** A cue on screen now carries QF text (its credit was lifted). */
export function activeCueCredited(track: CreditTrackLike | null | undefined): boolean {
  const active = track?.activeCues;
  if (!active) return false;
  for (let i = 0; i < active.length; i++) {
    const cue = active[i];
    if (cue && credited.has(cue)) return true;
  }
  return false;
}

/** The track shows QF text somewhere (the captions menu lists the credit while it is shown). */
export const trackHasQuranCredit = (track: CreditTrackLike | null | undefined): boolean => !!track && creditedTracks.has(track);

/** The caption track being shown, or null. */
export function showingCaptionTrack<T extends CreditTrackLike>(tracks: ArrayLike<T> | null | undefined): T | null {
  if (!tracks) return null;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t && (t.kind === 'subtitles' || t.kind === 'captions') && t.mode === 'showing') return t;
  }
  return null;
}
