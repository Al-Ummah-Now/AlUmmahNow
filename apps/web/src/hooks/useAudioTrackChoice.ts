/**
 * Plays the right audio track (wiki AUN-MULTI-AUDIO MA7): the viewer's saved choice, else a track
 * in the site's language, else the creator's default. Re-applied on every new source (a delivery
 * fallback or a source switch in useDeliveryPlayback) and whenever the track changes; a choice made
 * in the menu is saved before it switches (SettingsMenu), so it is the choice re-applied.
 *
 * Applied only once the media has its metadata: VHS can stall a load when a track is switched
 * while its media groups are still being set up, and Safari's own HLS makes its own pick (by the
 * system language) as metadata loads, which would override an earlier choice.
 */
import { useEffect } from 'react';
import type { AudioTrackView } from '@al-ummah/shared-types';
import { enableAudioTrack, matchTracks, pickAudioTrack, readAudioPreference, type PlayerAudioTrack } from '@/lib/video/audio-tracks';
import { logger } from '@/lib/logger-client';

type Tracks = ArrayLike<PlayerAudioTrack> & { addEventListener?(e: string, f: () => void): void; removeEventListener?(e: string, f: () => void): void };
interface PlayerLike {
  on(e: string, f: () => void): void;
  off(e: string, f: () => void): void;
  currentSrc(): string;
  readyState?(): number;
  audioTracks?(): Tracks;
}

export function useAudioTrackChoice(player: PlayerLike | null, audioTracks: AudioTrackView[] | undefined, siteLanguage: string): void {
  useEffect(() => {
    if (!player || !audioTracks || audioTracks.length < 2) return;
    let loggedFor: string | null = null;
    const apply = () => {
      if ((player.readyState?.() ?? 0) < 1) return;
      const list = player.audioTracks?.();
      if (!list || list.length < 2) return;
      const meta = matchTracks(list, audioTracks);
      const enabled = Array.from(list).flatMap((t, i) => (t.enabled ? [i] : []));
      // A track the API does not describe can only be the viewer's own pick: leave it
      if (enabled.length === 1 && !meta[enabled[0]!]) return;
      const index = pickAudioTrack(meta, { saved: readAudioPreference(), siteLanguage });
      // Safari can enable several audio tracks at once: done only when ours is the one enabled
      if (index === null || (enabled.length === 1 && enabled[0] === index)) return;
      enableAudioTrack(list, index);
      const src = player.currentSrc();
      if (loggedFor !== src) {
        loggedFor = src;
        logger.debug('[AudioTracks] First track chosen', { index, language: meta[index]?.language });
      }
    };
    const tracks = player.audioTracks?.();
    player.on('loadedmetadata', apply);
    player.on('canplay', apply);
    tracks?.addEventListener?.('addtrack', apply);
    // Safari's own HLS may switch tracks itself after loading; the menu saves a viewer's pick
    // before switching, so re-applying here only ever undoes a switch nobody asked for
    tracks?.addEventListener?.('change', apply);
    apply();
    return () => {
      player.off('loadedmetadata', apply);
      player.off('canplay', apply);
      tracks?.removeEventListener?.('addtrack', apply);
      tracks?.removeEventListener?.('change', apply);
    };
  }, [player, audioTracks, siteLanguage]);
}
