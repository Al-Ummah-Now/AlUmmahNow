'use client';

import React, { useState } from 'react';
import { Headphones, ListMusic, Moon, Pause, Play, RotateCcw, RotateCw, Trash2, X } from 'lucide-react';
import { localizeDigits } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';
import { LISTEN_SPEEDS, SLEEP_PRESETS, useListenAudio, type SleepTimerSetting } from './listen-context';

function formatClock(seconds: number, locale: string): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  const raw = hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
  return localizeDigits(locale, raw);
}

function sleepLabel(setting: SleepTimerSetting, locale: string, labels: { off: string; end: string; mins: string }): string {
  if (setting === 'off') return labels.off;
  if (setting === 'end') return labels.end;
  return labels.mins.replace('{minutes}', localizeDigits(locale, setting));
}

export function ListenMiniBar() {
  const { t, lang, isRTL } = useLanguage();
  const {
    enabled,
    current,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    queue,
    sleepTimer,
    sleepRemainingSec,
    togglePlay,
    seek,
    skipBy,
    setPlaybackRate,
    setSleepTimer,
    removeFromQueue,
    clearQueue,
    startListening,
    stopListening,
  } = useListenAudio();

  const [showSleep, setShowSleep] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  if (!enabled || !current) return null;

  const listen = t.listen;
  const labels = {
    listenMode: listen?.listenMode ?? 'Listen',
    play: listen?.play ?? 'Play',
    pause: listen?.pause ?? 'Pause',
    back15: listen?.back15 ?? 'Back 15 seconds',
    forward30: listen?.forward30 ?? 'Forward 30 seconds',
    speed: listen?.speed ?? 'Speed',
    sleepTimer: listen?.sleepTimer ?? 'Sleep timer',
    sleepOff: listen?.sleepOff ?? 'Off',
    sleepMinutes: listen?.sleepMinutes ?? '{minutes} min',
    sleepEndOfEpisode: listen?.sleepEndOfEpisode ?? 'End of episode',
    queue: listen?.queue ?? 'Up next',
    queueEmpty: listen?.queueEmpty ?? 'Your listening queue is empty.',
    clearQueue: listen?.clearQueue ?? 'Clear',
    removeFromQueue: listen?.removeFromQueue ?? 'Remove',
    closeMiniPlayer: listen?.closeMiniPlayer ?? 'Close audio player',
    openWatchPage: listen?.openWatchPage ?? 'Open video page',
  };

  const nextSpeed = () => {
    const idx = LISTEN_SPEEDS.indexOf(playbackRate as (typeof LISTEN_SPEEDS)[number]);
    const next = LISTEN_SPEEDS[(idx + 1) % LISTEN_SPEEDS.length] ?? 1;
    setPlaybackRate(next);
  };

  const progressMax = duration > 0 ? duration : Math.max(currentTime, 1);

  return (
    <aside
      dir={isRTL ? 'rtl' : 'ltr'}
      aria-label={labels.listenMode}
      data-testid="listen-mini-bar"
      className="fixed bottom-0 inset-x-0 z-50 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur shadow-lg"
    >
      {/* Sleep timer popover */}
      {showSleep && (
        <div
          role="dialog"
          aria-label={labels.sleepTimer}
          data-testid="listen-sleep-popover"
          className="absolute bottom-full end-4 mb-2 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-2"
        >
          <div className="px-2 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400">{labels.sleepTimer}</div>
          <div className="flex flex-col gap-1">
            {SLEEP_PRESETS.map((preset) => {
              const active = sleepTimer === preset;
              return (
                <button
                  key={String(preset)}
                  type="button"
                  data-testid={`listen-sleep-${String(preset)}`}
                  onClick={() => {
                    setSleepTimer(preset);
                    setShowSleep(false);
                  }}
                  className={`text-start px-2.5 py-1.5 rounded text-sm transition-colors ${
                    active
                      ? 'bg-emerald-600 text-white font-medium'
                      : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {sleepLabel(preset, lang, { off: labels.sleepOff, end: labels.sleepEndOfEpisode, mins: labels.sleepMinutes })}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Queue drawer */}
      {showQueue && (
        <div
          role="dialog"
          aria-label={labels.queue}
          data-testid="listen-queue-drawer"
          className="absolute bottom-full end-4 mb-2 w-80 max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3"
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-200 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {labels.queue} ({localizeDigits(lang, queue.length)})
            </span>
            {queue.length > 0 && (
              <button
                type="button"
                data-testid="listen-queue-clear"
                onClick={clearQueue}
                className="text-xs text-red-600 dark:text-red-400 hover:underline"
              >
                {labels.clearQueue}
              </button>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 py-3 text-center" data-testid="listen-queue-empty">
              {labels.queueEmpty}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {queue.map((item) => (
                <li
                  key={item.videoId}
                  data-testid={`listen-queue-item-${item.videoId}`}
                  className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <button
                    type="button"
                    onClick={() => {
                      removeFromQueue(item.videoId);
                      startListening(item, { startTime: 0, autoPlay: true });
                    }}
                    className="min-w-0 flex-1 text-start"
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.title}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.channelName}</div>
                  </button>
                  <button
                    type="button"
                    aria-label={labels.removeFromQueue}
                    data-testid={`listen-queue-remove-${item.videoId}`}
                    onClick={() => removeFromQueue(item.videoId)}
                    className="p-1.5 rounded text-gray-500 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div className="px-3 pt-1">
        <input
          type="range"
          min={0}
          max={progressMax}
          value={Math.min(currentTime, progressMax)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={labels.listenMode}
          data-testid="listen-progress"
          className="w-full h-1.5 accent-emerald-600 cursor-pointer"
        />
      </div>

      {/* Main controls row */}
      <div className="max-w-7xl mx-auto px-3 py-2 flex items-center justify-between gap-3">
        {/* Track metadata */}
        <Link
          href={`/${lang}/video/${encodeURIComponent(current.videoId)}`}
          aria-label={labels.openWatchPage}
          data-testid="listen-track-link"
          className="flex items-center gap-2.5 min-w-0 flex-1"
        >
          {current.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.thumbnailUrl}
              alt=""
              className="w-10 h-10 rounded object-cover flex-shrink-0 bg-gray-200 dark:bg-gray-800"
            />
          ) : (
            <div className="w-10 h-10 rounded bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
              <Headphones className="w-5 h-5 text-emerald-700 dark:text-emerald-300" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-white truncate" data-testid="listen-track-title">
              {current.title}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
              {current.channelName} · {formatClock(currentTime, lang)} / {formatClock(duration, lang)}
            </div>
          </div>
        </Link>

        {/* Playback buttons */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <button
            type="button"
            aria-label={labels.back15}
            data-testid="listen-back-15"
            onClick={() => skipBy(-15)}
            className="p-2 rounded-full text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label={isPlaying ? labels.pause : labels.play}
            data-testid="listen-play-toggle"
            onClick={togglePlay}
            className="p-2.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            type="button"
            aria-label={labels.forward30}
            data-testid="listen-forward-30"
            onClick={() => skipBy(30)}
            className="p-2 rounded-full text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* Speed, sleep timer, queue, close */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
          <button
            type="button"
            aria-label={labels.speed}
            data-testid="listen-speed-button"
            onClick={nextSpeed}
            className="px-2 py-1 rounded text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {localizeDigits(lang, `${playbackRate}×`)}
          </button>
          <button
            type="button"
            aria-label={labels.sleepTimer}
            data-testid="listen-sleep-button"
            onClick={() => {
              setShowSleep((v) => !v);
              setShowQueue(false);
            }}
            className={`px-2 py-1.5 rounded flex items-center gap-1 text-xs ${
              sleepTimer !== 'off'
                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 font-medium'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <Moon className="w-4 h-4" />
            {sleepRemainingSec !== null && <span data-testid="listen-sleep-remaining">{formatClock(sleepRemainingSec, lang)}</span>}
          </button>
          <button
            type="button"
            aria-label={labels.queue}
            data-testid="listen-queue-button"
            onClick={() => {
              setShowQueue((v) => !v);
              setShowSleep(false);
            }}
            className="px-2 py-1.5 rounded flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ListMusic className="w-4 h-4" />
            {queue.length > 0 && <span>{localizeDigits(lang, queue.length)}</span>}
          </button>
          <button
            type="button"
            aria-label={labels.closeMiniPlayer}
            data-testid="listen-close-button"
            onClick={stopListening}
            className="p-1.5 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
