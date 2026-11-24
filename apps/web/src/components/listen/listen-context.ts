'use client';

import { createContext, useContext } from 'react';

/**
 * Metadata stored for a queued Listen-mode item.
 * Intentionally excludes any resolved/signed audio URL so queued items never go stale;
 * the fresh URL is resolved via `GET /api/v1/videos/:id/audio` right when the item starts playing.
 */
export interface ListenQueueItem {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl?: string;
  duration?: number;
}

export interface ListenTrack extends ListenQueueItem {
  audioUrl: string;
  contentType?: string;
}

export type SleepTimerSetting = 'off' | 'end' | 15 | 30 | 45 | 60;

export const LISTEN_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SLEEP_PRESETS: readonly SleepTimerSetting[] = ['off', 15, 30, 45, 60, 'end'];

export interface ListenAudioContextValue {
  enabled: boolean;
  current: ListenTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  queue: ListenQueueItem[];
  sleepTimer: SleepTimerSetting;
  sleepRemainingSec: number | null;
  error: string | null;
  clearError: () => void;
  startListening: (track: ListenTrack, opts?: { startTime?: number; playbackRate?: number; autoPlay?: boolean }) => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  skipBy: (deltaSeconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setSleepTimer: (setting: SleepTimerSetting) => void;
  addToQueue: (item: ListenQueueItem) => void;
  removeFromQueue: (videoId: string) => void;
  clearQueue: () => void;
  playQueuedItem: (videoId: string) => Promise<void>;
  playNext: () => void;
  stopListening: () => void;
}

export const ListenAudioContext = createContext<ListenAudioContextValue | null>(null);

export function useListenAudio(): ListenAudioContextValue {
  const ctx = useContext(ListenAudioContext);
  if (!ctx) {
    return {
      enabled: false,
      current: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      queue: [],
      sleepTimer: 'off',
      sleepRemainingSec: null,
      error: null,
      clearError: () => undefined,
      startListening: () => undefined,
      togglePlay: () => undefined,
      pause: () => undefined,
      seek: () => undefined,
      skipBy: () => undefined,
      setPlaybackRate: () => undefined,
      setSleepTimer: () => undefined,
      addToQueue: () => undefined,
      removeFromQueue: () => undefined,
      clearQueue: () => undefined,
      playQueuedItem: async () => undefined,
      playNext: () => undefined,
      stopListening: () => undefined,
    };
  }
  return ctx;
}
