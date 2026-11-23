"use client";
import React from "react";
import RelatedVideo from "@/components/relatedVideo";
import { VideoInfo } from "@/interfaces";
import { useLanguage } from "@/hooks/useLanguage";
import RelatedVideosSkeleton from "@/components/related/RelatedVideosSkeleton";
import RelatedVideosFailed from "@/components/related/RelatedVideosFailed";
import type { RelatedShelfStatus } from "@/hooks/useRelatedVideos";

const RelatedVideosSection: React.FC<{ relatedVideos: VideoInfo[], keyPrefix: string | null, status: RelatedShelfStatus, onRetry?: () => void }> = ({ relatedVideos, keyPrefix, status, onRetry }) => {
  const { t } = useLanguage();
  // A successful empty answer hides the shelf: the owner's rule is no hollow sections (#1552)
  if (status === 'success' && relatedVideos.length === 0) return null;
  return (
    <div className="related-videos bg-white dark:bg-gray-900">
      <h2 className="text-lg font-bold mb-4 text-black dark:text-white ">{t.video.relatedVideos}</h2>
      {status === 'loading' ? <RelatedVideosSkeleton /> : status === 'error' ? <RelatedVideosFailed onRetry={onRetry} /> : (
        <div data-testid="related-videos-list" className="space-y-4 mx-4 md:mx-0">
          {relatedVideos.map((video) => (
            <RelatedVideo key={`${keyPrefix}_${video.id}`} {...video} />
          ))}
        </div>
      )}
    </div>
  );
};

export default RelatedVideosSection;
