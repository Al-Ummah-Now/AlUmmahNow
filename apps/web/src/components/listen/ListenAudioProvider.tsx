'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useFeatures } from '@/hooks/useFeatures';
import { ListenMiniBar } from './ListenMiniBar';
import {
  ListenAudioContext,
  LISTEN_SPEEDS,
  SLEEP_PRESETS,
  useListenAudio,
  type ListenAudioContextValue,
  type ListenTrack,
  type SleepTimerSetting,
} from './listen-context';

export { LISTEN_SPEEDS, SLEEP_PRESETS, useListenAudio };
export type { ListenAudioContextValue, ListenTrack, SleepTimerSetting };

export function ListenAudioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { features } = useFeatures();
  // E14-D3: Listen mode is strictly for signed-in viewers and gated behind the listenMode switch.
  const enabled = Boolean(user) && features.listenMode === true;
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [current, setCurrent] = useState<ListenTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [queue, setQueue] = useState<ListenTrack[]>([]);
  const [sleepTimer, setSleepTimerState] = useState<SleepTimerSetting>('off');
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);

  const pendingSeekRef = useRef<{ time: number; rate: number; autoPlay: boolean } | null>(null);

  const pause = useCallback(() => {
    const el = audioRef.current;
    if (el) el.pause();
    setIsPlaying(false);
  }, []);

  const stopListening = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
    }
    setCurrent(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSleepTimerState('off');
    setSleepRemainingSec(null);
  }, []);

  // Fail closed when the admin switch turns off
  useEffect(() => {
    if (!enabled && current) {
      stopListening();
    }
  }, [enabled, current, stopListening]);

  const startListening = useCallback(
    (track: ListenTrack, opts?: { startTime?: number; playbackRate?: number; autoPlay?: boolean }) => {
      if (!enabled) return;
      const startTime = Math.max(0, opts?.startTime ?? 0);
      const rate = opts?.playbackRate ?? playbackRate;
      const autoPlay = opts?.autoPlay ?? true;
      pendingSeekRef.current = { time: startTime, rate, autoPlay };
      setCurrent(track);
      setCurrentTime(startTime);
      setDuration(track.duration ?? 0);
      setPlaybackRateState(rate);
      const el = audioRef.current;
      if (el) {
        if (el.src !== track.audioUrl) {
          el.src = track.audioUrl;
        }
        el.playbackRate = rate;
        try {
          el.currentTime = startTime;
        } catch {
          // Applied in onLoadedMetadata once ready
        }
        if (autoPlay) {
          const p = el.play();
          if (p && typeof p.catch === 'function') p.catch(() => undefined);
          setIsPlaying(true);
        }
      }
    },
    [enabled, playbackRate],
  );

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    if (el.paused) {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, [current]);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    const clamped = Math.max(0, seconds);
    if (el) {
      const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : clamped;
      el.currentTime = Math.min(clamped, max);
    }
    setCurrentTime(clamped);
  }, []);

  const skipBy = useCallback(
    (deltaSeconds: number) => {
      const el = audioRef.current;
      const base = el ? el.currentTime : currentTime;
      seek(base + deltaSeconds);
    },
    [currentTime, seek],
  );

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, []);

  const setSleepTimer = useCallback((setting: SleepTimerSetting) => {
    setSleepTimerState(setting);
    if (typeof setting === 'number') {
      setSleepRemainingSec(setting * 60);
    } else {
      setSleepRemainingSec(null);
    }
  }, []);

  const addToQueue = useCallback(
    (track: ListenTrack) => {
      if (!enabled) return;
      setQueue((prev) => (prev.some((t) => t.videoId === track.videoId) ? prev : [...prev, track]));
    },
    [enabled],
  );

  const removeFromQueue = useCallback((videoId: string) => {
    setQueue((prev) => prev.filter((t) => t.videoId !== videoId));
  }, []);

  const clearQueue = useCallback(() => setQueue([]), []);

  const playNext = useCallback(() => {
    setQueue((prev) => {
      if (!prev.length) {
        pause();
        return prev;
      }
      const [next, ...rest] = prev;
      if (next) {
        setTimeout(() => startListening(next, { startTime: 0, playbackRate, autoPlay: true }), 0);
      }
      return rest;
    });
  }, [pause, playbackRate, startListening]);

  // Sleep timer countdown (1s tick while playing)
  useEffect(() => {
    if (typeof sleepTimer !== 'number' || sleepRemainingSec === null || !isPlaying) return;
    const id = window.setInterval(() => {
      setSleepRemainingSec((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          pause();
          setSleepTimerState('off');
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [sleepTimer, sleepRemainingSec, isPlaying, pause]);

  // Wire Media Session API for lock-screen & background controls
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession) return;
    const ms = navigator.mediaSession;
    if (!enabled || !current) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }
    if (typeof MediaMetadata !== 'undefined') {
      let artwork: MediaImage[] = [];
      if (current.thumbnailUrl) {
        try {
          const parsed = new URL(current.thumbnailUrl, typeof window !== 'undefined' ? window.location.origin : 'https://alummahnow.com');
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'data:') {
            artwork = [{ src: parsed.href, sizes: '512x512' }];
          }
        } catch {
          // Omit invalid artwork URL rather than throwing inside MediaMetadata
        }
      }
      try {
        ms.metadata = new MediaMetadata({
          title: current.title,
          artist: current.channelName,
          artwork,
        });
      } catch {
        // Ignore MediaMetadata errors on browsers with strict artwork URL checks
      }
    }
    ms.playbackState = isPlaying ? 'playing' : 'paused';
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported actions in older browsers
      }
    };
    setHandler('play', () => togglePlay());
    setHandler('pause', () => pause());
    setHandler('seekbackward', () => skipBy(-15));
    setHandler('seekforward', () => skipBy(30));
    setHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime);
    });
    setHandler('nexttrack', () => playNext());
    setHandler('previoustrack', () => seek(0));
    if (typeof ms.setPositionState === 'function' && duration > 0 && Number.isFinite(duration)) {
      try {
        ms.setPositionState({
          duration,
          playbackRate,
          position: Math.min(currentTime, duration),
        });
      } catch {
        // Ignore invalid position state
      }
    }
  }, [enabled, current, isPlaying, duration, playbackRate, currentTime, togglePlay, pause, skipBy, seek, playNext]);

  const value = useMemo<ListenAudioContextValue>(
    () => ({
      enabled,
      current,
      isPlaying,
      currentTime,
      duration,
      playbackRate,
      queue,
      sleepTimer,
      sleepRemainingSec,
      startListening,
      togglePlay,
      pause,
      seek,
      skipBy,
      setPlaybackRate,
      setSleepTimer,
      addToQueue,
      removeFromQueue,
      clearQueue,
      playNext,
      stopListening,
    }),
    [
      enabled,
      current,
      isPlaying,
      currentTime,
      duration,
      playbackRate,
      queue,
      sleepTimer,
      sleepRemainingSec,
      startListening,
      togglePlay,
      pause,
      seek,
      skipBy,
      setPlaybackRate,
      setSleepTimer,
      addToQueue,
      removeFromQueue,
      clearQueue,
      playNext,
      stopListening,
    ],
  );

  return (
    <ListenAudioContext.Provider value={value}>
      {children}
      {enabled && (
        <>
          <audio
            ref={audioRef}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
              const pending = pendingSeekRef.current;
              if (pending) {
                el.playbackRate = pending.rate;
                if (pending.time > 0) el.currentTime = pending.time;
                pendingSeekRef.current = null;
              }
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              if (sleepTimer === 'end') {
                pause();
                setSleepTimerState('off');
              } else {
                playNext();
              }
            }}
            className="hidden"
            data-testid="listen-audio-element"
          />
          <ListenMiniBar />
        </>
      )}
    </ListenAudioContext.Provider>
  );
}
