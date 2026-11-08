"use client";
import React from "react";

const PLACEHOLDER_CARDS = 6;

/** Placeholder cards shown while the related shelf loads (LTR and RTL). */
export default function RelatedVideosSkeleton() {
  return (
    <div data-testid="related-videos-skeleton" aria-hidden="true" className="space-y-4 mx-4 md:mx-0">
      {Array.from({ length: PLACEHOLDER_CARDS }, (_, index) => (
        <div key={index} className="flex gap-3 animate-pulse">
          <div className="w-40 h-24 shrink-0 rounded-lg bg-gray-200 dark:bg-gray-700" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      ))}
    </div>
  );
}
