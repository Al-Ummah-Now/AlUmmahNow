'use client';

/**
 * "Upload as Short / as video" (owner decision 2026-11-09). Auto lets the shared
 * rule decide (≤ 3 min and vertical or square = Short, shared-types
 * video-format.ts); the other two always win over detection.
 */
import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';

export type VideoFormatChoiceValue = 'auto' | 'short' | 'video';

const OPTIONS: VideoFormatChoiceValue[] = ['auto', 'short', 'video'];

interface VideoFormatChoiceProps {
  value: VideoFormatChoiceValue;
  onChange: (value: VideoFormatChoiceValue) => void;
  /** Distinguishes the radio group when several forms are on one page */
  name?: string;
  testIdPrefix?: string;
  disabled?: boolean;
}

/** The stored override as a choice: absent = auto. */
export function formatChoiceOf(video: { format?: unknown } | null | undefined): VideoFormatChoiceValue {
  return video?.format === 'short' || video?.format === 'video' ? video.format : 'auto';
}

export function VideoFormatChoice({ value, onChange, name = 'videoFormat', testIdPrefix = 'video-format', disabled }: VideoFormatChoiceProps) {
  const { t } = useLanguage();
  const label = (option: VideoFormatChoiceValue) =>
    option === 'short' ? t.video.formatShort : option === 'video' ? t.video.formatVideo : t.video.formatAuto;
  const hint = (option: VideoFormatChoiceValue) =>
    option === 'short' ? t.video.formatShortHint : option === 'video' ? t.video.formatVideoHint : t.video.formatAutoHint;

  return (
    <fieldset data-testid={testIdPrefix} disabled={disabled}>
      <legend className="block text-sm font-medium mb-1 dark:text-white">{t.video.formatLabel}</legend>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{t.video.formatHelp}</p>
      <div className="space-y-2">
        {OPTIONS.map((option) => (
          <label
            key={option}
            className="flex items-center gap-3 p-3 border dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="w-4 h-4"
              data-testid={`${testIdPrefix}-${option}`}
            />
            <div>
              <div className="font-medium dark:text-white">{label(option)}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{hint(option)}</div>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default VideoFormatChoice;
