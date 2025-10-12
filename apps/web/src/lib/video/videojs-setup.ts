import videojs, { type Player, type PlayerOptions } from 'video.js';
import 'video.js/dist/video-js.css';
import '@videojs/http-streaming';
import 'videojs-contrib-quality-levels';
import 'videojs-hls-quality-selector';

export const VIDEO_JS_OPTIONS: Partial<PlayerOptions> = {
  responsive: true,
  fluid: true,
  playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
  html5: {
    hls: {
      enableLowInitialPlaylist: true,
      smoothQualityChange: true,
      overrideNative: true
    }
  }
};

export function createVideoPlayer(
  element: HTMLVideoElement,
  options: PlayerOptions
): Player {
  return videojs(element, {
    ...VIDEO_JS_OPTIONS,
    ...options
  });
}

export function disposeVideoPlayer(player: Player | null) {
  if (player && !player.isDisposed()) {
    player.dispose();
  }
}
