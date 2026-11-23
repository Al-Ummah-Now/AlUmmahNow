"use client";
import React from "react";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * The related shelf's failed state (the request threw), in both layouts.
 * An empty-but-successful shelf hides the section instead — it is not a failure.
 */
const RelatedVideosError: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t } = useLanguage();
  return (
    <div data-testid="related-videos-error" role="alert" className="mx-4 md:mx-0 py-8 text-center">
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t.video.relatedError}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center rounded-[var(--aun-radius-button)] px-4 py-2 text-sm font-medium bg-[var(--aun-btn-filled-bg)] text-[var(--aun-btn-filled-fg)] hover:bg-[color-mix(in_srgb,var(--aun-btn-filled-fg)_8%,var(--aun-btn-filled-bg))] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] focus-visible:ring-offset-2"
        >
          {t.video.relatedErrorRetry}
        </button>
      )}
    </div>
  );
};

export default RelatedVideosError;
