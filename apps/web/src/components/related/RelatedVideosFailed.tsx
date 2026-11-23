"use client";
import React from "react";
import { useLanguage } from "@/hooks/useLanguage";

/** Shown when the related shelf's request failed, in both layouts. A successful empty answer hides the shelf instead (#1552). */
const RelatedVideosFailed: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t } = useLanguage();
  return (
    <div data-testid="related-videos-failed" className="mx-4 md:mx-0 py-8 text-center">
      <p className="mb-4 text-sm text-muted-foreground">{t.video.relatedLoadFailed}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          // Flat Material filled (packages/fanous-tokens/surfaces): the theme's primary, a state layer on hover
          className="inline-flex items-center rounded-[var(--aun-radius-button)] bg-[var(--aun-btn-filled-bg)] px-4 py-2 text-sm font-medium text-[var(--aun-btn-filled-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--aun-btn-filled-fg)_8%,var(--aun-btn-filled-bg))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] focus-visible:ring-offset-2"
        >
          {t.video.relatedLoadFailedRetry}
        </button>
      )}
    </div>
  );
};

export default RelatedVideosFailed;
