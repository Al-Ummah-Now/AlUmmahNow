/**
 * Audio tracks in the player (wiki AUN-MULTI-AUDIO MA7): which track plays first and how the menu
 * names each one. The package master lists the tracks in the same order as the API's
 * `audioTracks` (VideoView), so a player track's index finds its metadata.
 *
 * First track: the viewer's saved choice (language and kind) when the video has it; else a track
 * in the site's language (never audio description unless chosen); else the creator's default.
 */
import type { AudioTrackKind, AudioTrackView } from '@al-ummah/shared-types';

export const AUDIO_PREF_KEY = 'aun.player.audio';

export interface AudioPreference {
  language: string;
  kind: AudioTrackKind;
}

/** What the player's tracks look like (video.js AudioTrack). */
export interface PlayerAudioTrack {
  label?: string;
  language?: string;
  enabled: boolean;
}

const KINDS: readonly string[] = ['original', 'dub', 'commentary', 'description'];

export function readAudioPreference(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): AudioPreference | null {
  try {
    const raw = storage?.getItem(AUDIO_PREF_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<AudioPreference>;
    if (typeof v.language !== 'string' || !/^[a-z]{2,3}$/.test(v.language) || !KINDS.includes(String(v.kind))) return null;
    return { language: v.language, kind: v.kind as AudioTrackKind };
  } catch {
    return null;
  }
}

export function writeAudioPreference(pref: AudioPreference, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(AUDIO_PREF_KEY, JSON.stringify({ language: pref.language, kind: pref.kind }));
  } catch {
    // A blocked storage only loses the choice for the next video.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The API's track for each player track: by position when the counts match (the master's order),
 * else by language and name. Missing entries stay null.
 */
export function matchTracks(players: ArrayLike<PlayerAudioTrack>, meta: readonly AudioTrackView[] | undefined): (AudioTrackView | null)[] {
  const list = Array.from(players);
  const m = meta ?? [];
  if (m.length === list.length) return [...m];
  return list.map((p) => m.find((x) => x.language === p.language && (x.label === p.label || !p.label)) ?? m.find((x) => x.language === p.language) ?? null);
}

/** Index of the track to play first, or null to leave the player's own default. */
export function pickAudioTrack(meta: readonly (AudioTrackView | null)[], opts: { saved: AudioPreference | null; siteLanguage: string }): number | null {
  if (meta.length < 2) return null;
  const at = (pred: (t: AudioTrackView) => boolean) => meta.findIndex((t) => !!t && pred(t));
  if (opts.saved) {
    const exact = at((t) => t.language === opts.saved!.language && t.kind === opts.saved!.kind);
    if (exact >= 0) return exact;
    // Same language, another kind (never switch someone into audio description by language alone)
    const sameLang = at((t) => t.language === opts.saved!.language && (t.kind !== 'description' || opts.saved!.kind === 'description'));
    if (sameLang >= 0) return sameLang;
  }
  const site = at((t) => t.language === opts.siteLanguage && t.kind === 'original');
  if (site >= 0) return site;
  const siteDub = at((t) => t.language === opts.siteLanguage && t.kind !== 'description');
  if (siteDub >= 0) return siteDub;
  const def = at((t) => t.isDefault);
  return def >= 0 ? def : null;
}

/** The menu's name of a track: "<label> · <kind>" (the label alone when it already says the kind). */
export function audioTrackLabel(meta: AudioTrackView | null, player: PlayerAudioTrack, kindName: (kind: AudioTrackKind) => string, index: number): string {
  if (!meta) return player.label || player.language || String(index + 1);
  const kind = kindName(meta.kind);
  return meta.label.toLocaleLowerCase().includes(kind.toLocaleLowerCase()) ? meta.label : `${meta.label} · ${kind}`;
}

/** Enable exactly one track. */
export function enableAudioTrack(players: ArrayLike<PlayerAudioTrack>, index: number): void {
  Array.from(players).forEach((t, i) => {
    t.enabled = i === index;
  });
}

/** The API's audio tracks, kept only when well formed and at least two (VideoView.audioTracks). */
export function audioTracksOf(value: unknown): AudioTrackView[] {
  if (!Array.isArray(value)) return [];
  const out = value.filter(
    (t): t is AudioTrackView =>
      !!t && typeof t === 'object' && typeof t.id === 'string' && typeof t.language === 'string' && typeof t.label === 'string' && KINDS.includes(t.kind) && typeof t.isDefault === 'boolean',
  );
  return out.length > 1 ? out : [];
}

/** schema.org inLanguage of a video: every audio language (original first), else the given one. */
export function videoLanguages(tracks: readonly AudioTrackView[] | undefined, fallback: string): string | string[] {
  const langs = [...new Set((tracks ?? []).map((t) => t.language))];
  return langs.length > 1 ? langs : langs[0] ?? fallback;
}
