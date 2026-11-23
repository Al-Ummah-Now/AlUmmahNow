"use client";
import React from "react";
import { useLanguage } from "@/hooks/useLanguage";

/** Shown when loading the related-videos shelf fails, in both LTR and RTL layouts. */
const RelatedVideosError: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t } = useLanguage();
  return (
    <div
      data-testid="related-videos-error"
      role="alert"
      className="mx-4 md:mx-0 py-8 text-center"
    >
      <p className="mb-4 text-sm text-[var(--fanous-color-text-secondary)]">
        {t.video.relatedEmpty}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="aun-btn aun-btn-filled"
        >
          {t.video.relatedEmptyRetry}
        </button>
      )}
    </div>
  );
};

export default RelatedVideosError;
