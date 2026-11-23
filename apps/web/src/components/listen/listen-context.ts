'use client';

import { createContext, useContext } from 'react';

export interface ListenTrack {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl?: string;
  audioUrl: string;
  contentType?: string;
  duration?: number;
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
  queue: ListenTrack[];
  sleepTimer: SleepTimerSetting;
  sleepRemainingSec: number | null;
  startListening: (track: ListenTrack, opts?: { startTime?: number; playbackRate?: number; autoPlay?: boolean }) => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  skipBy: (deltaSeconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setSleepTimer: (setting: SleepTimerSetting) => void;
  addToQueue: (track: ListenTrack) => void;
  removeFromQueue: (videoId: string) => void;
  clearQueue: () => void;
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
      playNext: () => undefined,
      stopListening: () => undefined,
    };
  }
  return ctx;
}
