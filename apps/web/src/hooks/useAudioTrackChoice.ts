/**
 * Plays the right audio track first (wiki AUN-MULTI-AUDIO MA7): the viewer's saved choice, else a
 * track in the site's language, else the creator's default. Applied once per source, so a delivery
 * fallback or a source switch (useDeliveryPlayback) gets it again; a choice made in the menu is
 * saved there (SettingsMenu) and wins next time.
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
  audioTracks?(): Tracks;
}

export function useAudioTrackChoice(player: PlayerLike | null, audioTracks: AudioTrackView[] | undefined, siteLanguage: string): void {
  useEffect(() => {
    if (!player || !audioTracks || audioTracks.length < 2) return;
    let appliedFor: string | null = null;
    const apply = () => {
      const list = player.audioTracks?.();
      if (!list || list.length < 2) return;
      const src = player.currentSrc();
      if (appliedFor === src) return;
      appliedFor = src;
      const index = pickAudioTrack(matchTracks(list, audioTracks), { saved: readAudioPreference(), siteLanguage });
      if (index === null || list[index]?.enabled) return;
      enableAudioTrack(list, index);
      logger.debug('[AudioTracks] First track chosen', { index, language: audioTracks[index]?.language });
    };
    const tracks = player.audioTracks?.();
    player.on('loadedmetadata', apply);
    tracks?.addEventListener?.('addtrack', apply);
    apply();
    return () => {
      player.off('loadedmetadata', apply);
      tracks?.removeEventListener?.('addtrack', apply);
    };
  }, [player, audioTracks, siteLanguage]);
}
