"use client";
import React from "react";
import { useLanguage } from "@/hooks/useLanguage";

/** Shown when the related shelf has nothing to list, in both layouts. */
const RelatedVideosEmpty: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t } = useLanguage();
  return (
    <div data-testid="related-videos-empty" className="mx-4 md:mx-0 py-8 text-center">
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t.video.relatedEmpty}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          {t.video.relatedEmptyRetry}
        </button>
      )}
    </div>
  );
};

export default RelatedVideosEmpty;
