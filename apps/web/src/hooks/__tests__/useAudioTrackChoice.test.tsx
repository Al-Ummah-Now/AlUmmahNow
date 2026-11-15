/**
 * The first-track rule in the player (wiki AUN-MULTI-AUDIO MA7), against a fake video.js player
 * that behaves like the two HLS engines: VHS and Safari's own (which can enable several tracks at
 * once, list them in its own order and switch tracks itself after loading).
 */
import { act, renderHook } from '@testing-library/react';
import type { AudioTrackView } from '@al-ummah/shared-types';
import { useAudioTrackChoice } from '../useAudioTrackChoice';
import { AUDIO_PREF_KEY, writeAudioPreference } from '@/lib/video/audio-tracks';

const ORIG: AudioTrackView = { id: 'orig', language: 'ar', label: 'العربية', kind: 'original', isDefault: true };
const DUB: AudioTrackView = { id: 'tdub00000001', language: 'en', label: 'English', kind: 'dub', isDefault: false };

interface Track { language: string; label: string; enabled: boolean }

function fakePlayer(tracks: Track[], readyState = 0) {
  const on: Record<string, Set<() => void>> = {};
  const listOn: Record<string, Set<() => void>> = {};
  const list = Object.assign(tracks, {
    addEventListener: (e: string, f: () => void) => (listOn[e] ??= new Set()).add(f),
    removeEventListener: (e: string, f: () => void) => listOn[e]?.delete(f),
  });
  const player = {
    rs: readyState,
    on: (e: string, f: () => void) => (on[e] ??= new Set()).add(f),
    off: (e: string, f: () => void) => on[e]?.delete(f),
    currentSrc: () => 'https://media.example/master_a1.m3u8',
    readyState: () => player.rs,
    audioTracks: () => list,
    emit: (e: string) => on[e]?.forEach((f) => f()),
    emitList: (e: string) => listOn[e]?.forEach((f) => f()),
  };
  return player;
}

const enabled = (tracks: Track[]) => tracks.filter((t) => t.enabled).map((t) => t.language);

beforeEach(() => window.localStorage.removeItem(AUDIO_PREF_KEY));

describe('useAudioTrackChoice', () => {
  it('waits for metadata, then plays the track in the site language', () => {
    const tracks = [{ language: 'ar', label: 'العربية', enabled: true }, { language: 'en', label: 'English', enabled: false }];
    const p = fakePlayer(tracks);
    renderHook(() => useAudioTrackChoice(p, [ORIG, DUB], 'en'));
    act(() => p.emitList('addtrack'));
    expect(enabled(tracks)).toEqual(['ar']);
    p.rs = 1;
    act(() => p.emit('loadedmetadata'));
    expect(enabled(tracks)).toEqual(['en']);
  });

  it('leaves only its track on when Safari enabled several', () => {
    const tracks = [{ language: 'ar', label: 'العربية', enabled: true }, { language: 'en', label: 'English', enabled: true }];
    const p = fakePlayer(tracks, 4);
    renderHook(() => useAudioTrackChoice(p, [ORIG, DUB], 'ar'));
    expect(enabled(tracks)).toEqual(['ar']);
  });

  it('matches tracks by language and name when Safari lists them in its own order', () => {
    const tracks = [{ language: 'en', label: 'English', enabled: true }, { language: 'ar', label: 'العربية', enabled: false }];
    const p = fakePlayer(tracks, 4);
    renderHook(() => useAudioTrackChoice(p, [ORIG, DUB], 'ar'));
    expect(enabled(tracks)).toEqual(['ar']);
  });

  it('undoes a switch nobody asked for, and keeps a switch the viewer made in the menu', () => {
    const tracks = [{ language: 'ar', label: 'العربية', enabled: false }, { language: 'en', label: 'English', enabled: true }];
    const p = fakePlayer(tracks, 4);
    renderHook(() => useAudioTrackChoice(p, [ORIG, DUB], 'en'));
    expect(enabled(tracks)).toEqual(['en']);
    // The browser switches by itself
    tracks[0]!.enabled = true;
    tracks[1]!.enabled = false;
    act(() => p.emitList('change'));
    expect(enabled(tracks)).toEqual(['en']);
    // The viewer picks the original: the menu saves the choice, then switches
    writeAudioPreference({ language: 'ar', kind: 'original' });
    tracks[0]!.enabled = true;
    tracks[1]!.enabled = false;
    act(() => p.emitList('change'));
    expect(enabled(tracks)).toEqual(['ar']);
  });

  it('does nothing with one track or without the API list', () => {
    const tracks = [{ language: 'ar', label: 'العربية', enabled: true }];
    const p = fakePlayer(tracks, 4);
    renderHook(() => useAudioTrackChoice(p, [ORIG], 'en'));
    expect(enabled(tracks)).toEqual(['ar']);
    const two = [{ language: 'ar', label: 'العربية', enabled: true }, { language: 'en', label: 'English', enabled: false }];
    renderHook(() => useAudioTrackChoice(fakePlayer(two, 4), undefined, 'en'));
    expect(enabled(two)).toEqual(['ar']);
  });
});
