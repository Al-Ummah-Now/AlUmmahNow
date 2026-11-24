'use client';

import type { Player } from 'video.js';

export type VhsAudioPlayer = Player & {
  playbackRate: (rate?: number) => number;
  reset?: () => void;
};

/** True when a track URL or MIME type represents an HLS playlist that needs VHS outside Safari. */
export function isHlsAudioSource(url: string, contentType?: string): boolean {
  if (contentType && /mpegurl/i.test(contentType)) return true;
  try {
    const pathname = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://alummahnow.com').pathname;
    return /\.m3u8$/i.test(pathname);
  } catch {
    return /\.m3u8(?:$|\?)/i.test(url);
  }
}

/** True when the browser's `<audio>` element natively plays HLS (e.g. Safari / iOS WebKit). */
export function canPlayNativeHls(el: Pick<HTMLMediaElement, 'canPlayType'> | null): boolean {
  if (!el || typeof el.canPlayType !== 'function') return false;
  try {
    return Boolean(
      el.canPlayType('application/vnd.apple.mpegurl') || el.canPlayType('application/x-mpegURL'),
    );
  } catch {
    return false;
  }
}

export interface VhsAudioCallbacks {
  onLoadedMetadata: (duration: number) => void;
  onTimeUpdate: (currentTime: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
  onError: () => void;
}

/**
 * Creates a hidden audio-only Video.js player backed by `@videojs/http-streaming` (VHS) inside
 * `host` so HLS `.m3u8` audio streams play reliably in Chromium and Firefox (browsers without
 * native `<audio>` HLS support).
 */
export async function createVhsAudioPlayer(
  host: HTMLElement,
  callbacksRef: { current: VhsAudioCallbacks },
): Promise<VhsAudioPlayer> {
  const mod = await import('video.js');
  const videojs = (mod.default ?? mod) as unknown as (
    el: Element,
    options?: Record<string, unknown>,
  ) => VhsAudioPlayer;

  host.innerHTML = '';
  // Video.js VHS attaches its MSE HLS source handler reliably to `<video>` (not `<audio>`).
  // The element stays hidden and only fetches the audio-only HLS stream (`a/<track>/index.m3u8`).
  const mediaEl = document.createElement('video');
  mediaEl.className = 'video-js';
  mediaEl.setAttribute('preload', 'metadata');
  mediaEl.setAttribute('playsinline', '');
  mediaEl.setAttribute('data-testid', 'listen-vhs-audio-element');
  host.appendChild(mediaEl);

  const player = videojs(mediaEl, {
    controls: false,
    preload: 'metadata',
    html5: {
      vhs: { overrideNative: true },
      nativeAudioTracks: false,
      nativeVideoTracks: false,
    },
  });

  player.on('loadedmetadata', () => {
    const d = Number(player.duration?.() ?? 0);
    callbacksRef.current.onLoadedMetadata(d);
  });
  player.on('timeupdate', () => {
    const t = Number(player.currentTime?.() ?? 0);
    if (Number.isFinite(t)) callbacksRef.current.onTimeUpdate(t);
  });
  player.on('play', () => callbacksRef.current.onPlay());
  player.on('pause', () => callbacksRef.current.onPause());
  player.on('ended', () => callbacksRef.current.onEnded());
  player.on('error', () => callbacksRef.current.onError());

  return player;
}

export function disposeVhsAudioPlayer(player: VhsAudioPlayer | null, host: HTMLElement | null): void {
  if (player) {
    try {
      if (!player.isDisposed?.()) {
        player.pause?.();
        player.dispose?.();
      }
    } catch {
      // Ignore disposal errors during rapid teardown
    }
  }
  if (host) {
    host.innerHTML = '';
  }
}
