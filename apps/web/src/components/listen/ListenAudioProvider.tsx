'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useFeatures } from '@/hooks/useFeatures';
import { useLanguage } from '@/hooks/useLanguage';
import { fetchVideoAudio } from '@/lib/listen/audio-client';
import {
  canPlayNativeHls,
  createVhsAudioPlayer,
  disposeVhsAudioPlayer,
  isHlsAudioSource,
  type VhsAudioCallbacks,
  type VhsAudioPlayer,
} from '@/lib/listen/audio-engine';
import { ListenMiniBar } from './ListenMiniBar';
import {
  ListenAudioContext,
  LISTEN_SPEEDS,
  SLEEP_PRESETS,
  useListenAudio,
  type ListenAudioContextValue,
  type ListenQueueItem,
  type ListenTrack,
  type SleepTimerSetting,
} from './listen-context';

export { LISTEN_SPEEDS, SLEEP_PRESETS, useListenAudio };
export type { ListenAudioContextValue, ListenQueueItem, ListenTrack, SleepTimerSetting };

export function ListenAudioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { features } = useFeatures();
  const { t } = useLanguage();
  // E14-D3: Listen mode is strictly for signed-in viewers and gated behind the listenMode switch.
  const enabled = Boolean(user) && features.listenMode === true;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const vhsHostRef = useRef<HTMLDivElement | null>(null);
  const vhsPlayerRef = useRef<VhsAudioPlayer | null>(null);
  const activeBackendRef = useRef<'native' | 'vhs'>('native');
  const loadSeqRef = useRef(0);

  const [current, setCurrent] = useState<ListenTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [queue, setQueue] = useState<ListenQueueItem[]>([]);
  const [sleepTimer, setSleepTimerState] = useState<SleepTimerSetting>('off');
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queueRef = useRef<ListenQueueItem[]>(queue);
  queueRef.current = queue;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const sleepTimerRef = useRef(sleepTimer);
  sleepTimerRef.current = sleepTimer;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const unavailableMsgRef = useRef(
    t.listen?.audioUnavailable ?? 'Audio-only playback is not available for this video right now.',
  );
  unavailableMsgRef.current =
    t.listen?.audioUnavailable ?? 'Audio-only playback is not available for this video right now.';

  const pendingSeekRef = useRef<{ time: number; rate: number; autoPlay: boolean } | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const pause = useCallback(() => {
    if (activeBackendRef.current === 'vhs') {
      const vp = vhsPlayerRef.current;
      if (vp && !vp.isDisposed?.()) vp.pause();
    } else {
      const el = audioRef.current;
      if (el) el.pause();
    }
    setIsPlaying(false);
  }, []);

  const teardownVhs = useCallback(() => {
    disposeVhsAudioPlayer(vhsPlayerRef.current, vhsHostRef.current);
    vhsPlayerRef.current = null;
    activeBackendRef.current = 'native';
  }, []);

  const stopListening = useCallback(() => {
    loadSeqRef.current += 1;
    pendingSeekRef.current = null;
    teardownVhs();
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
    setError(null);
  }, [teardownVhs]);

  // Dispose VHS player cleanly on unmount
  useEffect(() => () => teardownVhs(), [teardownVhs]);

  // Fail closed when the admin switch turns off or user signs out
  useEffect(() => {
    if (!enabled && (current || vhsPlayerRef.current)) {
      stopListening();
    }
  }, [enabled, current, stopListening]);

  // Forward VHS callbacks through a ref so the Video.js player binds listeners once
  const vhsCallbacksRef = useRef<VhsAudioCallbacks>({
    onLoadedMetadata: () => undefined,
    onTimeUpdate: () => undefined,
    onPlay: () => undefined,
    onPause: () => undefined,
    onEnded: () => undefined,
    onError: () => undefined,
  });

  const startListening = useCallback(
    (track: ListenTrack, opts?: { startTime?: number; playbackRate?: number; autoPlay?: boolean }) => {
      if (!enabled) return;
      const seq = ++loadSeqRef.current;
      const startTime = Math.max(0, opts?.startTime ?? 0);
      const rate = opts?.playbackRate ?? playbackRateRef.current;
      const autoPlay = opts?.autoPlay ?? true;
      pendingSeekRef.current = { time: startTime, rate, autoPlay };
      setError(null);
      setCurrent(track);
      setCurrentTime(startTime);
      setDuration(track.duration ?? 0);
      setPlaybackRateState(rate);

      const el = audioRef.current;
      const needsVhs = isHlsAudioSource(track.audioUrl, track.contentType) && !canPlayNativeHls(el);

      if (needsVhs && vhsHostRef.current) {
        if (el) {
          el.pause();
          el.removeAttribute('src');
        }
        activeBackendRef.current = 'vhs';
        const host = vhsHostRef.current;
        void (async () => {
          try {
            let player = vhsPlayerRef.current;
            if (!player || player.isDisposed?.()) {
              player = await createVhsAudioPlayer(host, vhsCallbacksRef);
              if (loadSeqRef.current !== seq) {
                disposeVhsAudioPlayer(player, host);
                return;
              }
              vhsPlayerRef.current = player;
            }
            player.src([
              {
                src: track.audioUrl,
                type: track.contentType || 'application/x-mpegURL',
              },
            ]);
            player.playbackRate(rate);
            if (startTime > 0) {
              try {
                player.currentTime(startTime);
              } catch {
                // Applied on loadedmetadata once stream metadata arrives
              }
            }
            if (autoPlay) {
              const p = player.play() as Promise<void> | undefined;
              if (p && typeof p.catch === 'function') p.catch(() => undefined);
              setIsPlaying(true);
            }
          } catch {
            if (loadSeqRef.current === seq) {
              setIsPlaying(false);
              setError(unavailableMsgRef.current);
            }
          }
        })();
        return;
      }

      // Native audio (Safari/WebKit native HLS, or progressive audio file)
      teardownVhs();
      activeBackendRef.current = 'native';
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
    [enabled, teardownVhs],
  );

  const togglePlay = useCallback(() => {
    if (!current) return;
    if (activeBackendRef.current === 'vhs') {
      const vp = vhsPlayerRef.current;
      if (!vp || vp.isDisposed?.()) return;
      if (vp.paused()) {
        const p = vp.play() as Promise<void> | undefined;
        if (p && typeof p.catch === 'function') p.catch(() => undefined);
        setIsPlaying(true);
      } else {
        vp.pause();
        setIsPlaying(false);
      }
      return;
    }
    const el = audioRef.current;
    if (!el) return;
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
    const clamped = Math.max(0, seconds);
    if (activeBackendRef.current === 'vhs') {
      const vp = vhsPlayerRef.current;
      if (vp && !vp.isDisposed?.()) {
        const d = Number(vp.duration?.() ?? 0);
        const max = Number.isFinite(d) && d > 0 ? d : clamped;
        vp.currentTime(Math.min(clamped, max));
      }
    } else {
      const el = audioRef.current;
      if (el) {
        const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : clamped;
        el.currentTime = Math.min(clamped, max);
      }
    }
    setCurrentTime(clamped);
  }, []);

  const skipBy = useCallback(
    (deltaSeconds: number) => {
      let base = currentTimeRef.current;
      if (activeBackendRef.current === 'vhs') {
        const vp = vhsPlayerRef.current;
        if (vp && !vp.isDisposed?.()) {
          const tNow = Number(vp.currentTime?.() ?? base);
          if (Number.isFinite(tNow)) base = tNow;
        }
      } else if (audioRef.current) {
        base = audioRef.current.currentTime;
      }
      seek(base + deltaSeconds);
    },
    [seek],
  );

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate);
    if (activeBackendRef.current === 'vhs') {
      const vp = vhsPlayerRef.current;
      if (vp && !vp.isDisposed?.()) vp.playbackRate(rate);
    } else if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
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
    (item: ListenQueueItem) => {
      if (!enabled) return;
      if (queueRef.current.some((q) => q.videoId === item.videoId)) return;
      const nextQueue = [...queueRef.current, item];
      queueRef.current = nextQueue;
      setQueue(nextQueue);
    },
    [enabled],
  );

  const removeFromQueue = useCallback((videoId: string) => {
    const nextQueue = queueRef.current.filter((item) => item.videoId !== videoId);
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  }, []);

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setQueue([]);
  }, []);

  const resolveAndPlayQueuedItem = useCallback(
    async (item: ListenQueueItem) => {
      if (!enabled) return;
      const seq = ++loadSeqRef.current;
      setError(null);
      const resolved = await fetchVideoAudio(item.videoId);
      if (loadSeqRef.current !== seq) return;
      if (!resolved?.url) {
        pause();
        setError(unavailableMsgRef.current);
        return;
      }
      startListening(
        {
          ...item,
          audioUrl: resolved.url,
          contentType: resolved.contentType,
        },
        { startTime: 0, playbackRate: playbackRateRef.current, autoPlay: true },
      );
    },
    [enabled, pause, startListening],
  );

  const playQueuedItem = useCallback(
    async (videoId: string) => {
      if (!enabled) return;
      const currentQueue = queueRef.current;
      const item = currentQueue.find((q) => q.videoId === videoId);
      if (!item) return;
      const rest = currentQueue.filter((q) => q.videoId !== videoId);
      queueRef.current = rest;
      setQueue(rest);
      await resolveAndPlayQueuedItem(item);
    },
    [enabled, resolveAndPlayQueuedItem],
  );

  // Strict-Mode safe: reads from queueRef and triggers playback side effects OUTSIDE state updaters.
  const playNext = useCallback(() => {
    const currentQueue = queueRef.current;
    if (!currentQueue.length) {
      pause();
      return;
    }
    const [next, ...rest] = currentQueue;
    queueRef.current = rest;
    setQueue(rest);
    if (next) {
      void resolveAndPlayQueuedItem(next);
    }
  }, [pause, resolveAndPlayQueuedItem]);

  const handleTrackEnded = useCallback(() => {
    if (sleepTimerRef.current === 'end') {
      pause();
      setSleepTimerState('off');
    } else {
      playNext();
    }
  }, [pause, playNext]);

  // Keep VHS callbacks pointing at the latest handlers
  vhsCallbacksRef.current = {
    onLoadedMetadata: (d) => {
      if (Number.isFinite(d) && d > 0) setDuration(d);
      const pending = pendingSeekRef.current;
      const vp = vhsPlayerRef.current;
      if (pending && vp && !vp.isDisposed?.()) {
        vp.playbackRate(pending.rate);
        if (pending.time > 0) vp.currentTime(pending.time);
        pendingSeekRef.current = null;
      }
    },
    onTimeUpdate: (tNow) => setCurrentTime(tNow),
    onPlay: () => setIsPlaying(true),
    onPause: () => setIsPlaying(false),
    onEnded: handleTrackEnded,
    onError: () => {
      setIsPlaying(false);
      setError(unavailableMsgRef.current);
    },
  };

  // Sleep timer countdown (1s tick while playing; side effects stay outside state updaters)
  useEffect(() => {
    if (typeof sleepTimer !== 'number' || sleepRemainingSec === null || !isPlaying) return;
    if (sleepRemainingSec <= 0) {
      pause();
      setSleepTimerState('off');
      setSleepRemainingSec(null);
      return;
    }
    const id = window.setInterval(() => {
      setSleepRemainingSec((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [sleepTimer, sleepRemainingSec, isPlaying, pause]);

  // Media Session handlers: bind ONCE when active session starts, delegating through refs so
  // timeupdate ticks never rebind action handlers.
  const mediaActionsRef = useRef({ togglePlay, pause, skipBy, seek, playNext });
  mediaActionsRef.current = { togglePlay, pause, skipBy, seek, playNext };
  const hasActiveTrack = enabled && Boolean(current);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession) return;
    const ms = navigator.mediaSession;
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported actions in older browsers
      }
    };
    if (!hasActiveTrack) {
      const actions: MediaSessionAction[] = [
        'play',
        'pause',
        'seekbackward',
        'seekforward',
        'seekto',
        'nexttrack',
        'previoustrack',
      ];
      for (const a of actions) setHandler(a, null);
      return;
    }
    setHandler('play', () => mediaActionsRef.current.togglePlay());
    setHandler('pause', () => mediaActionsRef.current.pause());
    setHandler('seekbackward', () => mediaActionsRef.current.skipBy(-15));
    setHandler('seekforward', () => mediaActionsRef.current.skipBy(30));
    setHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') mediaActionsRef.current.seek(details.seekTime);
    });
    setHandler('nexttrack', () => mediaActionsRef.current.playNext());
    setHandler('previoustrack', () => mediaActionsRef.current.seek(0));
    return () => {
      const actions: MediaSessionAction[] = [
        'play',
        'pause',
        'seekbackward',
        'seekforward',
        'seekto',
        'nexttrack',
        'previoustrack',
      ];
      for (const a of actions) setHandler(a, null);
    };
  }, [hasActiveTrack]);

  // Media Session metadata & playback state (updates only on track or play/pause changes)
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
          const parsed = new URL(
            current.thumbnailUrl,
            typeof window !== 'undefined' ? window.location.origin : 'https://alummahnow.com',
          );
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
  }, [enabled, current, isPlaying]);

  // Media Session position state (lightweight update on time/duration/rate)
  useEffect(() => {
    if (!hasActiveTrack) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession) return;
    const ms = navigator.mediaSession;
    if (typeof ms.setPositionState === 'function' && duration > 0 && Number.isFinite(duration)) {
      try {
        ms.setPositionState({
          duration,
          playbackRate,
          position: Math.min(Math.max(0, currentTime), duration),
        });
      } catch {
        // Ignore invalid position state
      }
    }
  }, [hasActiveTrack, duration, playbackRate, currentTime]);

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
      error,
      clearError,
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
      playQueuedItem,
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
      error,
      clearError,
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
      playQueuedItem,
      playNext,
      stopListening,
    ],
  );

  return (
    <ListenAudioContext.Provider value={value}>
      {children}
      {enabled && (
        <>
          <div ref={vhsHostRef} className="hidden" data-testid="listen-vhs-host" />
          <audio
            ref={audioRef}
            preload="metadata"
            onLoadedMetadata={(e) => {
              if (activeBackendRef.current !== 'native') return;
              const el = e.currentTarget;
              if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
              const pending = pendingSeekRef.current;
              if (pending) {
                el.playbackRate = pending.rate;
                if (pending.time > 0) el.currentTime = pending.time;
                pendingSeekRef.current = null;
              }
            }}
            onTimeUpdate={(e) => {
              if (activeBackendRef.current !== 'native') return;
              setCurrentTime(e.currentTarget.currentTime);
            }}
            onPlay={() => {
              if (activeBackendRef.current !== 'native') return;
              setIsPlaying(true);
            }}
            onPause={() => {
              if (activeBackendRef.current !== 'native') return;
              setIsPlaying(false);
            }}
            onEnded={() => {
              if (activeBackendRef.current !== 'native') return;
              handleTrackEnded();
            }}
            onError={() => {
              if (activeBackendRef.current !== 'native') return;
              setIsPlaying(false);
              setError(unavailableMsgRef.current);
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
