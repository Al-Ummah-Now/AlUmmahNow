'use client';

import React, { useState } from 'react';
import { Headphones, ListPlus, Tv } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useListenAudio } from '@/components/listen/listen-context';
import { fetchVideoAudio } from '@/lib/listen/audio-client';

export interface ListenModeSwitchProps {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl?: string;
  duration?: number;
  /** Returns the current video player timestamp and playback speed when switching to Listen mode. */
  getVideoPlaybackState: () => { currentTime: number; playbackRate: number };
  /** Pauses the video player when entering Listen mode. */
  pauseVideo: () => void;
  /** Resumes the video player at the Listen audio timestamp and speed when leaving Listen mode. */
  resumeVideoAt: (seconds: number, playbackRate: number) => void;
  isListenView: boolean;
  onListenViewChange: (active: boolean) => void;
}

/**
 * Watch-page Listen mode toggle & audio-first surface (E14-S6).
 * Renders NOTHING when the `listenMode` feature switch is OFF or the viewer is signed out.
 */
export function ListenModeSwitch({
  videoId,
  title,
  channelName,
  thumbnailUrl,
  duration,
  getVideoPlaybackState,
  pauseVideo,
  resumeVideoAt,
  isListenView,
  onListenViewChange,
}: ListenModeSwitchProps) {
  const { t, isRTL } = useLanguage();
  const listen = useListenAudio();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Hidden when off: render nothing at all when listenMode feature switch is off or signed out
  if (!listen.enabled) return null;

  const labels = {
    listenMode: t.listen?.listenMode ?? 'Listen',
    watchVideo: t.listen?.watchVideo ?? 'Watch video',
    audioOnly: t.listen?.audioOnly ?? 'Audio only',
    addToQueue: t.listen?.addToQueue ?? 'Add to queue',
    loadingAudio: t.listen?.loadingAudio ?? 'Preparing audio…',
    audioUnavailable:
      t.listen?.audioUnavailable ?? 'Audio-only playback is not available for this video right now.',
  };

  const enterListenMode = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      let currentTime = 0;
      let playbackRate = 1;
      try {
        const state = getVideoPlaybackState();
        currentTime = Number.isFinite(state.currentTime) ? state.currentTime : 0;
        playbackRate = Number.isFinite(state.playbackRate) && state.playbackRate > 0 ? state.playbackRate : 1;
      } catch {
        // Video tech may not be initialized yet (or failed to load); still allow Listen mode.
      }
      const resolved = await fetchVideoAudio(videoId);
      if (!resolved?.url) {
        // E14-D5: never fall back to playing the video stream URL as audio.
        setErrorMessage(labels.audioUnavailable);
        return;
      }
      try {
        pauseVideo();
      } catch {
        // Ignore tech-not-ready pause errors from video.js.
      }
      listen.startListening(
        {
          videoId,
          title,
          channelName,
          thumbnailUrl,
          audioUrl: resolved.url,
          contentType: resolved.contentType,
          duration,
        },
        { startTime: currentTime, playbackRate, autoPlay: true },
      );
      onListenViewChange(true);
    } finally {
      setLoading(false);
    }
  };

  const returnToVideo = () => {
    const resumeTime = listen.current?.videoId === videoId ? listen.currentTime : 0;
    const rate = listen.playbackRate;
    listen.pause();
    onListenViewChange(false);
    resumeVideoAt(resumeTime, rate);
  };

  // Store metadata only — fresh audio URL is resolved via fetchVideoAudio when playback starts.
  const enqueueVideo = () => {
    setErrorMessage(null);
    listen.addToQueue({
      videoId,
      title,
      channelName,
      thumbnailUrl,
      duration,
    });
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="w-full" data-testid="watch-listen-controls">
      {isListenView ? (
        <div
          data-testid="watch-listen-card"
          className="w-full aspect-video max-h-[420px] rounded-lg border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] flex flex-col items-center justify-center gap-4 p-6 text-center"
        >
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailUrl} alt="" className="w-28 h-28 sm:w-36 sm:h-36 rounded-xl object-cover shadow-md" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-brand-soft flex items-center justify-center">
              <Headphones className="w-12 h-12 text-brand-ink" />
            </div>
          )}
          <div className="max-w-lg">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand text-on-brand mb-2">
              <Headphones className="w-3.5 h-3.5" />
              {labels.audioOnly}
            </span>
            <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)] line-clamp-2">{title}</h2>
            <p className="text-sm text-[var(--fanous-color-text-secondary)] mt-0.5">{channelName}</p>
          </div>
          <button
            type="button"
            data-testid="watch-video-toggle"
            onClick={returnToVideo}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-on-brand text-sm font-medium hover:bg-brand-hover hover:text-[var(--fanous-color-on-primary-hover)] transition-colors"
          >
            <Tv className="w-4 h-4" />
            {labels.watchVideo}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading}
              data-testid="watch-listen-toggle"
              onClick={() => void enterListenMode()}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-brand-edge bg-brand-soft text-brand-ink text-sm font-medium hover:bg-brand-soft/70 transition-colors disabled:opacity-60"
            >
              <Headphones className="w-4 h-4" />
              {loading ? labels.loadingAudio : labels.listenMode}
            </button>
            <button
              type="button"
              data-testid="watch-listen-queue"
              onClick={enqueueVideo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--fanous-color-outline)] text-[var(--fanous-color-text-primary)] text-sm hover:bg-[var(--fanous-color-surface-raised)] transition-colors"
            >
              <ListPlus className="w-4 h-4" />
              {labels.addToQueue}
            </button>
          </div>
          {errorMessage && (
            <p
              role="alert"
              data-testid="watch-listen-error"
              className="text-xs text-[var(--fanous-color-error-text)]"
            >
              {errorMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
