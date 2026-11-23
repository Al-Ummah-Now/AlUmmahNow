"use client";
import React from "react";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * The related shelf could not be loaded (no source answered), in both layouts. Never shown for an
 * empty answer: that hides the shelf (#1552). `onRetry` requests the shelf again.
 */
const RelatedVideosFailed: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { t } = useLanguage();
  return (
    <div data-testid="related-videos-failed" className="mx-4 md:mx-0 py-8 text-center">
      {/* Polite: the shelf sits beside the video, it must not interrupt it */}
      <p role="status" className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t.video.relatedFailed}</p>
      <button type="button" onClick={onRetry} className="aun-btn aun-btn-filled" data-testid="related-videos-retry">
        {t.video.relatedRetry}
      </button>
    </div>
  );
};

export default RelatedVideosFailed;
