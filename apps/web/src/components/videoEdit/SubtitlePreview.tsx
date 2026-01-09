'use client';

import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { SubtitleCue } from '@/lib/api/subtitles-types';
import { formatSubtitleTime } from '@/lib/api/subtitle-utils';
import { useLanguage } from '@/hooks/useLanguage';

interface SubtitlePreviewProps {
  cues: SubtitleCue[];
  warnings?: string[];
  className?: string;
}

/**
 * SubtitlePreview Component
 *
 * Shows the first 5 cues from an uploaded subtitle file
 * with timing and validation warnings.
 *
 * Mobile-first responsive design.
 */
export default function SubtitlePreview({
  cues,
  warnings = [],
  className = '',
}: SubtitlePreviewProps) {
  const { t } = useLanguage();

  if (cues.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Preview Header */}
      <div className="flex items-center justify-between">
        <h4 className="
          text-sm
          md:text-base
          font-semibold
          dark:text-white
        ">
          {t.subtitle?.preview || 'Subtitle Preview'}
        </h4>
        <span className="
          text-xs
          md:text-sm
          text-gray-600
          dark:text-gray-400
        ">
          {t.subtitle?.showingFirst5 || 'Showing first 5 cues'}
        </span>
      </div>

      {/* Warnings (if any) */}
      {warnings.length > 0 && (
        <div className="
          p-3
          md:p-4
          bg-orange-50
          dark:bg-orange-900/20
          border
          border-orange-200
          dark:border-orange-800
          rounded-lg
          space-y-2
        ">
          <div className="flex items-start gap-2">
            <AlertCircle className="
              w-4 h-4
              md:w-5 md:h-5
              text-orange-600
              dark:text-orange-400
              flex-shrink-0
              mt-0.5
            " />
            <div className="flex-1 min-w-0">
              <p className="
                text-xs
                md:text-sm
                font-medium
                text-orange-800
                dark:text-orange-300
                mb-1
              ">
                {t.subtitle?.warnings || 'Potential Issues Detected'}
              </p>
              <ul className="
                space-y-1
                text-xs
                md:text-sm
                text-orange-700
                dark:text-orange-400
                list-disc
                list-inside
              ">
                {warnings.map((warning, index) => (
                  <li key={index} className="break-words">{warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Cues Preview */}
      <div className="
        space-y-2
        md:space-y-3
        max-h-64
        md:max-h-96
        overflow-y-auto
        pr-2
      ">
        {cues.slice(0, 5).map((cue, index) => (
          <div
            key={index}
            className="
              p-3
              md:p-4
              bg-gray-50
              dark:bg-gray-800
              border
              border-gray-200
              dark:border-gray-700
              rounded-lg
              space-y-2
            "
          >
            {/* Timing */}
            <div className="
              flex
              items-center
              gap-2
              text-xs
              md:text-sm
              font-mono
              text-gray-600
              dark:text-gray-400
            ">
              <span className="font-semibold">
                [{formatSubtitleTime(cue.startTime)} → {formatSubtitleTime(cue.endTime)}]
              </span>
            </div>

            {/* Subtitle Text */}
            <p className="
              text-sm
              md:text-base
              text-gray-900
              dark:text-gray-100
              leading-relaxed
              break-words
            ">
              {cue.text}
            </p>
          </div>
        ))}
      </div>

      {/* Footer */}
      {cues.length > 5 && (
        <p className="
          text-xs
          md:text-sm
          text-gray-600
          dark:text-gray-400
          text-center
          py-2
        ">
          {t.subtitle?.moreCues?.replace('{count}', (cues.length - 5).toString()) ||
            `+${cues.length - 5} more cues`}
        </p>
      )}

      {/* Success Indicator */}
      {warnings.length === 0 && (
        <div className="
          flex
          items-center
          gap-2
          p-3
          md:p-4
          bg-green-50
          dark:bg-green-900/20
          border
          border-green-200
          dark:border-green-800
          rounded-lg
        ">
          <CheckCircle2 className="
            w-4 h-4
            md:w-5 md:h-5
            text-green-600
            dark:text-green-400
            flex-shrink-0
          " />
          <p className="
            text-xs
            md:text-sm
            text-green-800
            dark:text-green-300
            font-medium
          ">
            {t.subtitle?.noIssues || 'No issues detected. Subtitles look good!'}
          </p>
        </div>
      )}
    </div>
  );
}
