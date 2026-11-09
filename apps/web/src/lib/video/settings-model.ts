/**
 * The settings menu's logic, free of the DOM and of Video.js (docs/specs/VIDEO-PLAYER.md section 5).
 *
 * Quality keeps the behaviour of the production quality menu (videojs-hls-quality-selector):
 * "Auto" plus one entry per distinct rendition height, highest first. Choosing a height enables
 * only the renditions of that height; Auto enables them all and lets VHS adapt.
 */

export type PanelId = 'root' | 'quality' | 'speed' | 'captions' | 'audio';

export interface MenuOption {
  id: string;
  label: string;
}

export interface QualityLevelLike {
  height?: number;
  enabled: boolean;
}

export interface TextTrackLike {
  kind: string;
  label?: string;
  language?: string;
  mode: string;
}

export interface AudioTrackLike {
  id?: string;
  label?: string;
  language?: string;
  enabled: boolean;
}

export const AUTO = 'auto';
export const OFF = 'off';

const list = <T>(l: ArrayLike<T> | null | undefined): T[] => (l ? Array.from({ length: l.length }, (_, i) => l[i]) : []);

/** Distinct rendition heights, highest first. */
export function qualityHeights(levels: ArrayLike<QualityLevelLike> | null | undefined): number[] {
  const heights = new Set<number>();
  for (const l of list(levels)) if (l.height && l.height > 0) heights.add(l.height);
  return [...heights].sort((a, b) => b - a);
}

/** Menu options for quality, or none when the stream exposes no renditions (Safari native HLS). */
export function qualityOptions(levels: ArrayLike<QualityLevelLike> | null | undefined, autoLabel: string): MenuOption[] {
  const heights = qualityHeights(levels);
  if (heights.length === 0) return [];
  return [{ id: AUTO, label: autoLabel }, ...heights.map((h) => ({ id: String(h), label: `${h}p` }))];
}

/** "auto" while every rendition is enabled, otherwise the enabled height. */
export function currentQualityId(levels: ArrayLike<QualityLevelLike> | null | undefined): string {
  const all = list(levels).filter((l) => l.height);
  if (all.length === 0 || all.every((l) => l.enabled)) return AUTO;
  const on = all.find((l) => l.enabled);
  return on?.height ? String(on.height) : AUTO;
}

export function selectQuality(levels: ArrayLike<QualityLevelLike> | null | undefined, id: string): void {
  for (const l of list(levels)) l.enabled = id === AUTO || String(l.height) === id;
}

/** The value shown on the Quality row: "Auto (720p)" while adapting, or the chosen height. */
export function qualityValue(currentId: string, playingHeight: number | undefined, autoLabel: string): string {
  if (currentId !== AUTO) return `${currentId}p`;
  return playingHeight ? `${autoLabel} (${playingHeight}p)` : autoLabel;
}

export function speedLabel(rate: number, normalLabel: string): string {
  return rate === 1 ? normalLabel : `${rate}×`;
}

export function speedOptions(rates: number[], normalLabel: string): MenuOption[] {
  return rates.map((r) => ({ id: String(r), label: speedLabel(r, normalLabel) }));
}

export function captionTracks<T extends TextTrackLike>(tracks: ArrayLike<T> | null | undefined): T[] {
  return list(tracks).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
}

export function captionOptions(tracks: ArrayLike<TextTrackLike> | null | undefined, offLabel: string): MenuOption[] {
  const subs = captionTracks(tracks);
  if (subs.length === 0) return [];
  return [{ id: OFF, label: offLabel }, ...subs.map((t, i) => ({ id: String(i), label: t.label || t.language || String(i + 1) }))];
}

export function currentCaptionId(tracks: ArrayLike<TextTrackLike> | null | undefined): string {
  const i = captionTracks(tracks).findIndex((t) => t.mode === 'showing');
  return i >= 0 ? String(i) : OFF;
}

export function selectCaption(tracks: ArrayLike<TextTrackLike> | null | undefined, id: string): void {
  captionTracks(tracks).forEach((t, i) => {
    t.mode = String(i) === id ? 'showing' : 'disabled';
  });
}

export function audioOptions(tracks: ArrayLike<AudioTrackLike> | null | undefined): MenuOption[] {
  const all = list(tracks);
  if (all.length < 2) return [];
  return all.map((t, i) => ({ id: String(i), label: t.label || t.language || String(i + 1) }));
}

export function currentAudioId(tracks: ArrayLike<AudioTrackLike> | null | undefined): string {
  const i = list(tracks).findIndex((t) => t.enabled);
  return String(Math.max(0, i));
}

export function selectAudio(tracks: ArrayLike<AudioTrackLike> | null | undefined, id: string): void {
  list(tracks).forEach((t, i) => {
    t.enabled = String(i) === id;
  });
}

export interface RootRow {
  id: Exclude<PanelId, 'root'> | 'shortcuts';
  label: string;
  value?: string;
}

export interface RootInput {
  labels: { quality: string; speed: string; captions: string; audio: string; shortcuts: string };
  quality?: string;
  speed?: string;
  captions?: string;
  audio?: string;
}

/** The root rows, in the spec's order. Rows without a value are left out (no renditions, no tracks). */
export function rootRows(input: RootInput): RootRow[] {
  const rows: RootRow[] = [];
  if (input.quality !== undefined) rows.push({ id: 'quality', label: input.labels.quality, value: input.quality });
  if (input.speed !== undefined) rows.push({ id: 'speed', label: input.labels.speed, value: input.speed });
  if (input.captions !== undefined) rows.push({ id: 'captions', label: input.labels.captions, value: input.captions });
  if (input.audio !== undefined) rows.push({ id: 'audio', label: input.labels.audio, value: input.audio });
  rows.push({ id: 'shortcuts', label: input.labels.shortcuts });
  return rows;
}

export type MenuKeyAction = 'next' | 'prev' | 'first' | 'last' | 'activate' | 'open' | 'back' | 'close' | null;

/**
 * What a key does in the menu. The end-side arrow opens a submenu and the start-side arrow goes
 * back, so in RTL the two arrows swap. Escape goes back from a submenu and closes the root.
 */
export function menuKeyAction(key: string, dir: 'ltr' | 'rtl', inSubmenu: boolean): MenuKeyAction {
  const endArrow = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const startArrow = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case 'ArrowDown': return 'next';
    case 'ArrowUp': return 'prev';
    case 'Home': return 'first';
    case 'End': return 'last';
    case 'Enter':
    case ' ': return 'activate';
    case endArrow: return 'open';
    case startArrow:
    case 'Backspace': return inSubmenu ? 'back' : null;
    case 'Escape': return inSubmenu ? 'back' : 'close';
    case 'Tab': return 'close';
    default: return null;
  }
}

/** Roving focus with wrap. */
export function moveIndex(index: number, count: number, action: 'next' | 'prev' | 'first' | 'last'): number {
  if (count <= 0) return -1;
  if (action === 'first') return 0;
  if (action === 'last') return count - 1;
  const step = action === 'next' ? 1 : -1;
  return (((index + step) % count) + count) % count;
}
