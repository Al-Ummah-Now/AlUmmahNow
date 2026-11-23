"use client";
import React, { useCallback, useId, useRef } from "react";
import RelatedVideo from "@/components/relatedVideo/rtl";
import { useLanguage } from "@/hooks/useLanguage";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";
import RelatedVideosFailed from "@/components/related/RelatedVideosFailed";
import type { RelatedVideosSectionProps } from "@/components/related";

/**
 * The watch page's related shelf (RTL). Loading shows the skeleton, a failure the message and
 * "Try again"; an empty answer renders nothing, so no hollow section is left (#1552).
 */
const RelatedVideosSectionRTL: React.FC<RelatedVideosSectionProps> = ({ relatedVideos, status, onRetry }) => {
  const { t } = useLanguage();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The button leaves with the failure: keep focus in the shelf instead of dropping it to the page
  const retry = useCallback(() => {
    headingRef.current?.focus();
    onRetry();
  }, [onRetry]);
  if (status === "empty" || (status === "loaded" && relatedVideos.length === 0)) return null;
  return (
    <section className="related-videos bg-white dark:bg-gray-900" dir="rtl" aria-labelledby={headingId} aria-busy={status === "loading" || undefined} data-testid="related-videos">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-bold mb-4 text-black dark:text-white focus:outline-none">{t.video.relatedVideos}</h2>
      {status === "loading" ? <RelatedVideosSkeleton /> : status === "failed" ? <RelatedVideosFailed onRetry={retry} /> : (
        <div data-testid="related-videos-list" className="space-y-4">
          {relatedVideos.map((video) => (
            <RelatedVideo key={video.id} {...video} />
          ))}
        </div>
      )}
    </section>
  );
};

export default RelatedVideosSectionRTL;
