"use client";
import React, { useCallback, useId, useRef } from "react";
import RelatedVideo from "@/components/relatedVideo";
import { VideoInfo } from "@/interfaces";
import { useLanguage } from "@/hooks/useLanguage";
import type { RelatedShelfStatus } from "@/hooks/useRelatedVideos";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";
import RelatedVideosFailed from "@/components/related/RelatedVideosFailed";

export interface RelatedVideosSectionProps {
  relatedVideos: VideoInfo[];
  status: RelatedShelfStatus;
  onRetry: () => void;
}

/**
 * The watch page's related shelf (LTR). Loading shows the skeleton, a failure the message and
 * "Try again"; an empty answer renders nothing, so no hollow section is left (#1552).
 */
const RelatedVideosSection: React.FC<RelatedVideosSectionProps & { keyPrefix: string | null }> = ({ relatedVideos, keyPrefix, status, onRetry }) => {
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
    <section className="related-videos bg-white dark:bg-gray-900" aria-labelledby={headingId} aria-busy={status === "loading" || undefined} data-testid="related-videos">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-bold mb-4 text-black dark:text-white focus:outline-none">{t.video.relatedVideos}</h2>
      {status === "loading" ? <RelatedVideosSkeleton /> : status === "failed" ? <RelatedVideosFailed onRetry={retry} /> : (
        <div data-testid="related-videos-list" className="space-y-4 mx-4 md:mx-0">
          {relatedVideos.map((video) => (
            <RelatedVideo key={`${keyPrefix}_${video.id}`} {...video} />
          ))}
        </div>
      )}
    </section>
  );
};

export default RelatedVideosSection;
