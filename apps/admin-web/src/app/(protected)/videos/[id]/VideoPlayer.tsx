'use client';

/**
 * Admin preview player. Bunny HLS (playUrl, signed by api-videos) plays
 * natively where the browser can (Safari); elsewhere hls.js is loaded once
 * from cdnjs, pinned and checked with SRI. A plain MP4 (videoUrl) is the
 * fallback.
 */
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';

const HLS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js';
const HLS_SRI = 'sha384-V5ruNBgmYcC3SJRUQeNykAAAgde5gOFq/Hu0CZj7bygDP0yRIhkvX8+w0u/7mRvr';

interface HlsInstance {
  loadSource(src: string): void;
  attachMedia(el: HTMLMediaElement): void;
  destroy(): void;
  on(event: string, cb: (event: string, data: { fatal?: boolean }) => void): void;
}
interface HlsCtor {
  new (): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string };
}

let hlsLoading: Promise<HlsCtor | null> | null = null;
function loadHls(): Promise<HlsCtor | null> {
  const existing = (window as unknown as { Hls?: HlsCtor }).Hls;
  if (existing) return Promise.resolve(existing);
  hlsLoading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = HLS_SRC;
    script.integrity = HLS_SRI;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => resolve((window as unknown as { Hls?: HlsCtor }).Hls ?? null);
    script.onerror = () => {
      hlsLoading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return hlsLoading;
}

export function VideoPlayer({ playUrl, videoUrl, poster, title }: { playUrl: string | null; videoUrl: string | null; poster: string | null; title: string }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: HlsInstance | null = null;
    let cancelled = false;
    setFailed(false);
    if (playUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playUrl;
    } else if (playUrl) {
      loadHls().then((Hls) => {
        if (cancelled) return;
        if (Hls?.isSupported()) {
          hls = new Hls();
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data?.fatal) {
              if (videoUrl) video.src = videoUrl;
              else setFailed(true);
            }
          });
          hls.loadSource(playUrl);
          hls.attachMedia(video);
        } else if (videoUrl) {
          video.src = videoUrl;
        } else {
          setFailed(true);
        }
      });
    } else if (videoUrl) {
      video.src = videoUrl;
    }
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [playUrl, videoUrl]);

  if (!playUrl && !videoUrl) {
    return (
      <div className="aspect-video w-full rounded bg-surface-2 flex items-center justify-center text-fg-muted text-sm" data-testid="video-no-preview">
        {t('videos.noPreview')}
      </div>
    );
  }
  return (
    <div>
      <video ref={ref} controls playsInline preload="metadata" poster={poster ?? undefined} aria-label={title} className="aspect-video w-full rounded bg-fg" data-testid="video-player" />
      {failed && <p className="mt-2 text-sm text-danger-fg">{t('videos.noPreview')}</p>}
    </div>
  );
}
