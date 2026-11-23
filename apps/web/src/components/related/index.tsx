"use client";
import React, { useId } from "react";
import RelatedVideo from "@/components/relatedVideo";
import { VideoInfo } from "@/interfaces";
import { useLanguage } from "@/hooks/useLanguage";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";
import RelatedVideosError from "@/components/related/RelatedVideosError";

export interface RelatedVideosSectionProps {
  relatedVideos: VideoInfo[];
  keyPrefix: string | null;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

const RelatedVideosSection: React.FC<RelatedVideosSectionProps> = ({
  relatedVideos,
  keyPrefix,
  loading = false,
  failed = false,
  onRetry,
}) => {
  const { t } = useLanguage();
  const headingId = useId();

  if (!loading && !failed && relatedVideos.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
      className="related-videos bg-white dark:bg-gray-900"
    >
      <h2 id={headingId} className="text-lg font-bold mb-4 text-black dark:text-white ">
        {t.video.relatedVideos}
      </h2>
      {loading ? (
        <RelatedVideosSkeleton />
      ) : failed ? (
        <RelatedVideosError onRetry={onRetry} />
      ) : (
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
