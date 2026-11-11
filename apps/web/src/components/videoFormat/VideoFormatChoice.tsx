'use client';

/**
 * "Upload as Short / as video" (owner decision 2026-11-09). Auto lets the shared
 * rule decide (≤ 3 min and vertical or square = Short, shared-types
 * video-format.ts); the other two always win over detection.
 */
import React from 'react';
import { OptionCard } from '@/components/ui/OptionCard';
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
      <legend className="block text-sm font-medium mb-1 text-[var(--fanous-color-text-primary)]">{t.video.formatLabel}</legend>
      <p className="text-sm text-[var(--fanous-color-text-secondary)] mb-2">{t.video.formatHelp}</p>
      <div className="space-y-2">
        {OPTIONS.map((option) => (
          <OptionCard
            key={option}
            name={name}
            value={option}
            checked={value === option}
            onSelect={() => onChange(option)}
            title={label(option)}
            help={hint(option)}
            inputTestId={`${testIdPrefix}-${option}`}
          />
        ))}
      </div>
    </fieldset>
  );
}

export default VideoFormatChoice;
