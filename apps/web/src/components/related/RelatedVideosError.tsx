"use client";
import React from "react";
import { useLanguage } from "@/hooks/useLanguage";

const RelatedVideosError: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t } = useLanguage();
  return (
    <div data-testid="related-videos-error" className="mx-4 md:mx-0 py-8 text-center">
      <p className="mb-4 text-sm text-[var(--fanous-color-text-secondary)]" role="alert">{t.video.relatedEmpty}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[var(--aun-radius-button)] bg-[var(--aun-btn-filled-bg)] px-4 py-2 text-sm font-medium text-[var(--aun-btn-filled-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--aun-btn-filled-fg)_8%,var(--aun-btn-filled-bg))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] focus-visible:ring-offset-2"
        >
          {t.video.relatedEmptyRetry}
        </button>
      )}
    </div>
  );
};

export default RelatedVideosError;
