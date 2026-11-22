'use client';

/**
 * The caption editor's preview video. The browser's own controls show their clock in Latin digits on
 * Arabic pages ("0:00 / 0:20"), so this draws its own small bar instead: play/pause, the time in the
 * page's digits as the player shows it (#1541: current before duration, read left to right), a seek
 * slider and fullscreen. Labels are the player's own.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Maximize, Pause, Play } from 'lucide-react';
import { getAriaLabels } from '@/lib/video/accessibility';
import { formatPlayerTime } from '@/lib/video/player-time';

interface CuePreviewVideoProps {
  src: string;
  poster?: string;
  lang: 'en' | 'ar';
}

const CuePreviewVideo = forwardRef<HTMLVideoElement | null, CuePreviewVideoProps>(function CuePreviewVideo({ src, poster, lang }, ref) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle<HTMLVideoElement | null, HTMLVideoElement | null>(ref, () => videoRef.current, []);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const labels = getAriaLabels(lang);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      setPlaying(!v.paused && !v.ended);
      setTime(v.currentTime);
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    };
    const events = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange', 'seeked'] as const;
    events.forEach((e) => v.addEventListener(e, sync));
    sync();
    return () => events.forEach((e) => v.removeEventListener(e, sync));
  }, [src]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play().catch(() => undefined);
    else v.pause();
  };

  const fullscreen = () => {
    const box = boxRef.current;
    if (!box) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void box.requestFullscreen?.().catch(() => undefined);
  };

  const btn = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div ref={boxRef} className="overflow-hidden rounded-lg border border-border bg-card">
      <video ref={videoRef} src={src} poster={poster} playsInline preload="metadata" onClick={toggle} className="aspect-video w-full bg-muted" />
      {/* The bar reads left to right on Arabic pages too, as the player's control bar does */}
      <div dir="ltr" className="flex items-center gap-2 px-1.5 py-1">
        <button type="button" className={btn} onClick={toggle} aria-label={playing ? labels.pauseButton : labels.playButton}>
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </button>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          <span aria-label={labels.currentTime}>{formatPlayerTime(lang, time)}</span>
          {' / '}
          <span aria-label={labels.duration}>{formatPlayerTime(lang, duration)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          disabled={!duration}
          aria-label={labels.progressBar}
          aria-valuetext={`${formatPlayerTime(lang, time)} / ${formatPlayerTime(lang, duration)}`}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = Number(e.target.value);
          }}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
        />
        <button type="button" className={btn} onClick={fullscreen} aria-label={labels.fullscreenButton}>
          <Maximize className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
});

export default CuePreviewVideo;
